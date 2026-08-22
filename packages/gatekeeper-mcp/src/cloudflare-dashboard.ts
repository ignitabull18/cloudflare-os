// Read-only dashboard adapter for Cloudflare's official API MCP.
//
// The MCP's `execute` tool can call the entire Cloudflare API, including writes. This module never
// accepts code from a browser or agent. It sends two fixed programs: account discovery and a
// dashboard snapshot made exclusively from GET requests and GraphQL analytics reads.

import type {
  CloudflareDashboardAccount,
  CloudflareDashboardMetric,
  CloudflareDashboardRange,
  CloudflareDashboardSnapshot,
} from "@gadgets/workshop-shared/cloudflare-gatekeeper";

export const CLOUDFLARE_API_MCP_ORIGIN = "https://mcp.cloudflare.com";
export const CLOUDFLARE_API_MCP_PATH = "/mcp";

type ExecuteCode = (code: string, accountId?: string) => Promise<unknown>;

const ACCOUNT_DISCOVERY_CODE = `async () => {
  const response = await cloudflare.request({
    method: "GET",
    path: "/accounts",
    query: { per_page: 50 },
  });
  return (Array.isArray(response.result) ? response.result : []).map(account => ({
    id: String(account.id),
    name: String(account.name || account.id),
  }));
}`;

const RANGE_CONFIG: Record<CloudflareDashboardRange, { durationMs: number; bucketMs: number }> = {
  "24h": { durationMs: 24 * 60 * 60 * 1000, bucketMs: 60 * 60 * 1000 },
  "7d": { durationMs: 7 * 24 * 60 * 60 * 1000, bucketMs: 24 * 60 * 60 * 1000 },
  "30d": { durationMs: 30 * 24 * 60 * 60 * 1000, bucketMs: 24 * 60 * 60 * 1000 },
};

function dashboardCode(range: CloudflareDashboardRange): string {
  const config = RANGE_CONFIG[range];
  return `async () => {
  const range = ${JSON.stringify(range)};
  const durationMs = ${config.durationMs};
  const bucketMs = ${config.bucketMs};
  const unavailable = (id, label, unit, error) => ({
    id,
    label,
    value: null,
    unit,
    status: "unavailable",
    note: error
      ? String(error.message || error).slice(0, 180)
      : "This metric is not available through the current MCP grant or Cloudflare plan.",
  });
  const metric = (id, label, unit, value, previousValue) => ({
    id,
    label,
    unit,
    value,
    ...(previousValue === undefined ? {} : { previousValue }),
    status: "ready",
  });
  const safe = async fn => {
    try { return { ok: true, value: await fn() }; }
    catch (error) { return { ok: false, error: String(error && error.message || error) }; }
  };
  const request = options => cloudflare.request(options).then(response => response.result);
  const graphql = async (query, variables) => {
    const response = await cloudflare.request({
      method: "POST",
      path: "/graphql",
      body: { query, variables },
    });
    if (response.errors && response.errors.length > 0) {
      throw new Error(response.errors.map(error => error.message).join("; "));
    }
    return response.result;
  };
  const count = value => Array.isArray(value)
    ? value.length
    : Array.isArray(value && value.buckets)
      ? value.buckets.length
      : Array.isArray(value && value.result)
        ? value.result.length
        : 0;
  const inventory = async (id, label, path, query) => {
    const result = await safe(() => request({ method: "GET", path, query }));
    return result.ok
      ? metric(id, label, "count", count(result.value))
      : unavailable(id, label, "count", result.error);
  };
  const ratio = (numerator, denominator) => denominator > 0 ? numerator / denominator * 100 : 0;
  const emptyTotals = () => ({ requests: 0, bytes: 0, cachedRequests: 0, errors: 0 });
  const addTotals = (target, source) => {
    target.requests += source.requests;
    target.bytes += source.bytes;
    target.cachedRequests += source.cachedRequests;
    target.errors += source.errors;
  };

  const now = new Date();
  const endMs = bucketMs < 86400000
    ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1)
    : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const start = new Date(endMs - durationMs);
  const end = new Date(endMs);
  const previousStart = new Date(start.getTime() - durationMs);

  const zonesResult = await safe(() => request({
    method: "GET",
    path: "/zones",
    query: { "account.id": accountId, per_page: 50 },
  }));
  const zones = zonesResult.ok && Array.isArray(zonesResult.value)
    ? zonesResult.value.map(zone => ({
        id: String(zone.id),
        name: String(zone.name || zone.id),
        status: String(zone.status || "unknown"),
      }))
    : [];

  const serviceDefinitions = [
    ["workers", "Workers", "/accounts/" + accountId + "/workers/scripts"],
    ["pages", "Pages projects", "/accounts/" + accountId + "/pages/projects"],
    ["d1", "D1 databases", "/accounts/" + accountId + "/d1/database", { per_page: 100 }],
    ["r2", "R2 buckets", "/accounts/" + accountId + "/r2/buckets", { per_page: 1000 }],
    ["kv", "KV namespaces", "/accounts/" + accountId + "/storage/kv/namespaces", { per_page: 1000 }],
    ["queues", "Queues", "/accounts/" + accountId + "/queues", { per_page: 100 }],
    ["hyperdrive", "Hyperdrive configs", "/accounts/" + accountId + "/hyperdrive/configs"],
    ["vectorize", "Vectorize indexes", "/accounts/" + accountId + "/vectorize/v2/indexes"],
    ["ai-gateway", "AI Gateways", "/accounts/" + accountId + "/ai-gateway/gateways", { per_page: 100 }],
    ["access", "Access apps", "/accounts/" + accountId + "/access/apps", { per_page: 100 }],
    ["tunnels", "Cloudflare Tunnels", "/accounts/" + accountId + "/cfd_tunnel", { is_deleted: false, per_page: 100 }],
    ["turnstile", "Turnstile sites", "/accounts/" + accountId + "/challenges/widgets"],
    ["stream", "Stream videos", "/accounts/" + accountId + "/stream", { limit: 1000 }],
  ];
  const servicesPromise = Promise.all(serviceDefinitions.map(definition =>
    inventory(definition[0], definition[1], definition[2], definition[3])));

  const zonePeriod = async (zoneTag, periodStart, periodEnd) => {
    if (bucketMs >= 86400000) {
      const dailyQuery = \`query DashboardZoneDaily($zoneTag: string!, $start: Date!, $end: Date!) {
        viewer { zones(filter: { zoneTag: $zoneTag }) {
          daily: httpRequests1dGroups(
            limit: 100, orderBy: [date_ASC]
            filter: { date_geq: $start, date_lt: $end }
          ) {
            sum {
              requests
              bytes
              cachedRequests
              responseStatusMap { edgeResponseStatus requests }
            }
            dimensions { date }
          }
        } }
      }\`;
      const dateOnly = date => date.toISOString().slice(0, 10);
      const data = await graphql(dailyQuery, {
        zoneTag,
        start: dateOnly(periodStart),
        end: dateOnly(periodEnd),
      });
      const groups = data && data.viewer && data.viewer.zones && data.viewer.zones[0]
        && data.viewer.zones[0].daily;
      if (!groups) throw new Error("Cloudflare returned no daily traffic analytics for this zone.");
      const totals = emptyTotals();
      const points = [];
      for (const group of groups) {
        const requests = Number(group.sum && group.sum.requests || 0);
        const bytes = Number(group.sum && group.sum.bytes || 0);
        const cachedRequests = Number(group.sum && group.sum.cachedRequests || 0);
        const errors = (group.sum && group.sum.responseStatusMap || [])
          .filter(entry => Number(entry.edgeResponseStatus) >= 500
            && Number(entry.edgeResponseStatus) < 600)
          .reduce((sum, entry) => sum + Number(entry.requests || 0), 0);
        totals.requests += requests;
        totals.bytes += bytes;
        totals.cachedRequests += cachedRequests;
        totals.errors += errors;
        const date = group.dimensions && group.dimensions.date;
        if (date) {
          points.push({
            timestamp: new Date(String(date) + "T00:00:00.000Z").toISOString(),
            requests,
            bandwidth: bytes,
            cachedRequests,
            errors,
          });
        }
      }
      return { totals, points };
    }
    const query = \`query DashboardZone($zoneTag: string!, $start: Time!, $end: Time!) {
      viewer { zones(filter: { zoneTag: $zoneTag }) {
        all: httpRequestsAdaptiveGroups(
          limit: 10000, orderBy: [datetimeHour_ASC]
          filter: { datetime_geq: $start, datetime_lt: $end, requestSource: "eyeball" }
        ) { count sum { edgeResponseBytes } dimensions { datetimeHour } }
        cached: httpRequestsAdaptiveGroups(
          limit: 10000, orderBy: [datetimeHour_ASC]
          filter: { datetime_geq: $start, datetime_lt: $end, requestSource: "eyeball", cacheStatus: "hit" }
        ) { count dimensions { datetimeHour } }
        errors: httpRequestsAdaptiveGroups(
          limit: 10000, orderBy: [datetimeHour_ASC]
          filter: { datetime_geq: $start, datetime_lt: $end, requestSource: "eyeball",
            edgeResponseStatus_geq: 500, edgeResponseStatus_lt: 600 }
        ) { count dimensions { datetimeHour } }
      } }
    }\`;
    const data = await graphql(query, {
      zoneTag,
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
    });
    const zone = data && data.viewer && data.viewer.zones && data.viewer.zones[0];
    if (!zone) throw new Error("Cloudflare returned no traffic analytics for this zone.");
    const byTime = new Map();
    const totals = emptyTotals();
    const timestampFor = group => {
      const value = group && group.dimensions && group.dimensions.datetimeHour;
      if (!value) return undefined;
      const date = new Date(value);
      const normalized = bucketMs >= 86400000
        ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
        : Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours());
      return new Date(normalized).toISOString();
    };
    const pointFor = timestamp => {
      if (!byTime.has(timestamp)) {
        byTime.set(timestamp, { timestamp, requests: 0, bandwidth: 0, cachedRequests: 0, errors: 0 });
      }
      return byTime.get(timestamp);
    };
    for (const group of zone.all || []) {
      const requests = Number(group.count || 0);
      const bytes = Number(group.sum && group.sum.edgeResponseBytes || 0);
      totals.requests += requests;
      totals.bytes += bytes;
      const timestamp = timestampFor(group);
      if (timestamp) {
        pointFor(timestamp).requests += requests;
        pointFor(timestamp).bandwidth += bytes;
      }
    }
    for (const group of zone.cached || []) {
      const value = Number(group.count || 0);
      totals.cachedRequests += value;
      const timestamp = timestampFor(group);
      if (timestamp) pointFor(timestamp).cachedRequests += value;
    }
    for (const group of zone.errors || []) {
      const value = Number(group.count || 0);
      totals.errors += value;
      const timestamp = timestampFor(group);
      if (timestamp) pointFor(timestamp).errors += value;
    }
    return { totals, points: [...byTime.values()] };
  };

  const zoneThreats = async zoneTag => {
    const hourly = bucketMs < 86400000;
    const query = hourly
      ? \`query DashboardThreatsHourly($zoneTag: string!, $start: Time!, $end: Time!) {
          viewer { zones(filter: { zoneTag: $zoneTag }) {
            groups: httpRequests1hGroups(
              limit: 100, orderBy: [datetime_ASC]
              filter: { datetime_geq: $start, datetime_lt: $end }
            ) { sum { threats } dimensions { datetime } }
          } }
        }\`
      : \`query DashboardThreatsDaily($zoneTag: string!, $start: Date!, $end: Date!) {
          viewer { zones(filter: { zoneTag: $zoneTag }) {
            groups: httpRequests1dGroups(
              limit: 100, orderBy: [date_ASC]
              filter: { date_geq: $start, date_lt: $end }
            ) { sum { threats } dimensions { date } }
          } }
        }\`;
    const dateOnly = date => date.toISOString().slice(0, 10);
    const data = await graphql(query, {
      zoneTag,
      start: hourly ? start.toISOString() : dateOnly(start),
      end: hourly ? end.toISOString() : dateOnly(end),
    });
    const groups = data && data.viewer && data.viewer.zones && data.viewer.zones[0]
      && data.viewer.zones[0].groups;
    if (!groups) throw new Error("Threat analytics are not available for this zone or plan.");
    return groups.reduce((total, group) => total + Number(group.sum && group.sum.threats || 0), 0);
  };

  const zoneSecurity = async zoneTag => {
    const query = \`query DashboardSecurity($zoneTag: string!, $start: Time!, $end: Time!) {
      viewer { zones(filter: { zoneTag: $zoneTag }) {
        groups: firewallEventsAdaptiveGroups(
          limit: 1000, orderBy: [count_DESC]
          filter: { datetime_geq: $start, datetime_lt: $end }
        ) { count dimensions { action } }
      } }
    }\`;
    try {
      const data = await graphql(query, {
        zoneTag,
        start: start.toISOString(),
        end: end.toISOString(),
      });
      const groups = data && data.viewer && data.viewer.zones && data.viewer.zones[0]
        && data.viewer.zones[0].groups;
      if (!groups) throw new Error("Security analytics are not available for this zone or plan.");
      return groups.map(group => ({
        id: String(group.dimensions && group.dimensions.action || "unknown"),
        label: String(group.dimensions && group.dimensions.action || "unknown"),
        value: Number(group.count || 0),
      }));
    } catch (firewallError) {
      const threats = await zoneThreats(zoneTag);
      return [{
        id: "threats-detected",
        label: "Threats detected",
        value: threats,
      }];
    }
  };

  const workersPeriod = async (periodStart, periodEnd) => {
    const query = \`query DashboardWorkers($accountTag: string!, $start: string!, $end: string!) {
      viewer { accounts(filter: { accountTag: $accountTag }) {
        groups: workersInvocationsAdaptive(
          limit: 10000, filter: { datetime_geq: $start, datetime_lt: $end }
        ) { sum { requests errors } dimensions { scriptName status } }
      } }
    }\`;
    const data = await graphql(query, {
      accountTag: accountId,
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
    });
    const groups = data && data.viewer && data.viewer.accounts && data.viewer.accounts[0]
      && data.viewer.accounts[0].groups;
    if (!groups) throw new Error("Workers analytics are not available for this account or plan.");
    const totals = { requests: 0, errors: 0 };
    const byScript = new Map();
    for (const group of groups) {
      const requests = Number(group.sum && group.sum.requests || 0);
      const errors = Number(group.sum && group.sum.errors || 0);
      totals.requests += requests;
      totals.errors += errors;
      const name = String(group.dimensions && group.dimensions.scriptName || "Unknown Worker");
      const current = byScript.get(name) || { requests: 0, errors: 0 };
      current.requests += requests;
      current.errors += errors;
      byScript.set(name, current);
    }
    return {
      totals,
      workers: [...byScript.entries()]
        .map(([id, values]) => ({
          id,
          label: id,
          value: values.requests,
          secondaryValue: values.errors,
        }))
        .sort((a, b) => b.value - a.value),
    };
  };

  const analyticsPromise = (async () => {
    if (zones.length === 0) {
      const reason = zonesResult.ok ? undefined : zonesResult.error;
      return {
        analyticsZonesRead: 0,
        analyticsNote: reason ? "Zone analytics could not be read." : undefined,
        headline: [
          unavailable("requests", "Requests", "count", reason),
          unavailable("bandwidth", "Data transfer", "bytes", reason),
          unavailable("cache-hit-rate", "Cache hit rate", "percent", reason),
          unavailable("error-rate", "5xx error rate", "percent", reason),
        ],
        traffic: [],
        zones: [],
        securityEvents: unavailable("security-events", "Security events", "count", reason),
        securityActions: [],
        workerRequests: unavailable("worker-requests", "Worker requests", "count", reason),
        workerErrors: unavailable("worker-errors", "Worker errors", "count", reason),
        workers: [],
      };
    }
    const [zoneResults, securityResults, workersCurrent, workersPrevious] = await Promise.all([
      Promise.all(zones.map(async zone => ({
        zone,
        current: await safe(() => zonePeriod(zone.id, start, end)),
        previous: await safe(() => zonePeriod(zone.id, previousStart, start)),
      }))),
      Promise.all(zones.map(zone => safe(() => zoneSecurity(zone.id)))),
      safe(() => workersPeriod(start, end)),
      safe(() => workersPeriod(previousStart, start)),
    ]);
    const readable = zoneResults.filter(result => result.current.ok);
    const currentTotals = emptyTotals();
    const previousTotals = emptyTotals();
    const trafficByTime = new Map();
    const zoneSummaries = [];
    for (const result of readable) {
      addTotals(currentTotals, result.current.value.totals);
      if (result.previous.ok) addTotals(previousTotals, result.previous.value.totals);
      for (const point of result.current.value.points) {
        const aggregate = trafficByTime.get(point.timestamp) || {
          timestamp: point.timestamp, requests: 0, bandwidth: 0, cachedRequests: 0, errors: 0,
        };
        aggregate.requests += point.requests;
        aggregate.bandwidth += point.bandwidth;
        aggregate.cachedRequests += point.cachedRequests;
        aggregate.errors += point.errors;
        trafficByTime.set(point.timestamp, aggregate);
      }
      zoneSummaries.push({
        ...result.zone,
        requests: result.current.value.totals.requests,
        bandwidth: result.current.value.totals.bytes,
        cacheHitRate: ratio(result.current.value.totals.cachedRequests, result.current.value.totals.requests),
        errorRate: ratio(result.current.value.totals.errors, result.current.value.totals.requests),
      });
    }
    const allPrevious = readable.length > 0 && readable.every(result => result.previous.ok);
    const securityActions = new Map();
    let securityEvents = 0;
    let readableSecurityZones = 0;
    for (const result of securityResults) {
      if (!result.ok) continue;
      readableSecurityZones++;
      for (const action of result.value) {
        securityEvents += action.value;
        securityActions.set(action.id, (securityActions.get(action.id) || 0) + action.value);
      }
    }
    const firstTrafficError = zoneResults.find(result => !result.current.ok);
    const firstSecurityError = securityResults.find(result => !result.ok);
    return {
      analyticsZonesRead: readable.length,
      analyticsNote: readable.length < zones.length
        ? readable.length + " of " + zones.length + " zones are included; unavailable zones were excluded."
        : undefined,
      headline: readable.length > 0 ? [
        metric("requests", "Requests", "count", currentTotals.requests,
          allPrevious ? previousTotals.requests : undefined),
        metric("bandwidth", "Data transfer", "bytes", currentTotals.bytes,
          allPrevious ? previousTotals.bytes : undefined),
        metric("cache-hit-rate", "Cache hit rate", "percent",
          ratio(currentTotals.cachedRequests, currentTotals.requests),
          allPrevious ? ratio(previousTotals.cachedRequests, previousTotals.requests) : undefined),
        metric("error-rate", "5xx error rate", "percent",
          ratio(currentTotals.errors, currentTotals.requests),
          allPrevious ? ratio(previousTotals.errors, previousTotals.requests) : undefined),
      ] : [
        unavailable("requests", "Requests", "count", firstTrafficError && firstTrafficError.current.error),
        unavailable("bandwidth", "Data transfer", "bytes", firstTrafficError && firstTrafficError.current.error),
        unavailable("cache-hit-rate", "Cache hit rate", "percent", firstTrafficError && firstTrafficError.current.error),
        unavailable("error-rate", "5xx error rate", "percent", firstTrafficError && firstTrafficError.current.error),
      ],
      traffic: [...trafficByTime.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
      zones: zoneSummaries.sort((a, b) => b.requests - a.requests),
      securityEvents: readableSecurityZones > 0
        ? metric("security-events", "Security events", "count", securityEvents)
        : unavailable("security-events", "Security events", "count",
            firstSecurityError && firstSecurityError.error),
      securityActions: [...securityActions.entries()]
        .map(([id, value]) => ({ id, label: id || "unknown", value }))
        .sort((a, b) => b.value - a.value),
      workerRequests: workersCurrent.ok
        ? metric("worker-requests", "Worker requests", "count", workersCurrent.value.totals.requests,
            workersPrevious.ok ? workersPrevious.value.totals.requests : undefined)
        : unavailable("worker-requests", "Worker requests", "count", workersCurrent.error),
      workerErrors: workersCurrent.ok
        ? metric("worker-errors", "Worker errors", "count", workersCurrent.value.totals.errors,
            workersPrevious.ok ? workersPrevious.value.totals.errors : undefined)
        : unavailable("worker-errors", "Worker errors", "count", workersCurrent.error),
      workers: workersCurrent.ok ? workersCurrent.value.workers : [],
    };
  })();

  const [services, analytics] = await Promise.all([servicesPromise, analyticsPromise]);
  return {
    periodStart: start.toISOString(),
    analyticsZonesRead: analytics.analyticsZonesRead,
    analyticsZonesTotal: zones.length,
    analyticsNote: analytics.analyticsNote,
    headline: analytics.headline,
    traffic: analytics.traffic,
    zones: analytics.zones,
    securityEvents: analytics.securityEvents,
    securityActions: analytics.securityActions,
    workerRequests: analytics.workerRequests,
    workerErrors: analytics.workerErrors,
    workers: analytics.workers,
    services: [
      zonesResult.ok
        ? metric("zones", "Zones", "count", zones.length)
        : unavailable("zones", "Zones", "count", zonesResult.error),
      ...services,
    ],
  };
}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAccounts(value: unknown): CloudflareDashboardAccount[] {
  if (!Array.isArray(value)) throw new Error("Cloudflare API MCP returned an invalid account list.");
  const accounts: CloudflareDashboardAccount[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.name !== "string") {
      throw new Error("Cloudflare API MCP returned an invalid account entry.");
    }
    accounts.push({ id: entry.id, name: entry.name });
  }
  return accounts;
}

function unavailableMetric(id: string, label: string): CloudflareDashboardMetric {
  return {
    id,
    label,
    value: null,
    unit: "count",
    status: "unavailable",
    note: "Choose a Cloudflare account to load this metric.",
  };
}

type DashboardData = Omit<CloudflareDashboardSnapshot,
  "connected" | "generatedAt" | "accounts" | "account" | "needsAccountSelection" | "range">;

function parseDashboardData(value: unknown): DashboardData {
  if (!isRecord(value)
      || !Array.isArray(value.headline)
      || !Array.isArray(value.traffic)
      || !Array.isArray(value.zones)
      || !Array.isArray(value.securityActions)
      || !Array.isArray(value.workers)
      || !Array.isArray(value.services)
      || !isRecord(value.securityEvents)
      || !isRecord(value.workerRequests)
      || !isRecord(value.workerErrors)
      || typeof value.analyticsZonesRead !== "number"
      || typeof value.analyticsZonesTotal !== "number") {
    throw new Error("Cloudflare API MCP returned an invalid dashboard snapshot.");
  }
  return value as DashboardData;
}

/** Builds a dashboard snapshot through the connected official Cloudflare API MCP account. */
export async function getCloudflareMcpDashboardSnapshot(
  execute: ExecuteCode,
  accountId?: string,
  requestedRange: CloudflareDashboardRange = "24h",
): Promise<CloudflareDashboardSnapshot> {
  const range = requestedRange in RANGE_CONFIG ? requestedRange : "24h";
  const accounts = parseAccounts(await execute(ACCOUNT_DISCOVERY_CODE));
  const selected = accountId
    ? accounts.find(account => account.id === accountId)
    : accounts.length === 1 ? accounts[0] : undefined;
  if (accountId && !selected) throw new Error("The selected Cloudflare account is not accessible.");

  const base = {
    connected: true,
    generatedAt: new Date().toISOString(),
    accounts,
    needsAccountSelection: accounts.length > 1 && !selected,
    range,
  };
  if (!selected) {
    return {
      ...base,
      analyticsZonesRead: 0,
      analyticsZonesTotal: 0,
      headline: [],
      traffic: [],
      zones: [],
      securityEvents: unavailableMetric("security-events", "Security events"),
      securityActions: [],
      workerRequests: unavailableMetric("worker-requests", "Worker requests"),
      workerErrors: unavailableMetric("worker-errors", "Worker errors"),
      workers: [],
      services: [],
    };
  }

  const data = parseDashboardData(await execute(dashboardCode(range), selected.id));
  return { ...base, account: selected, ...data };
}

/** Fixed account-discovery program, exported for focused adapter tests. */
export const cloudflareAccountDiscoveryCodeForTest = ACCOUNT_DISCOVERY_CODE;

/** Fixed dashboard program, exported for focused adapter tests. */
export const cloudflareDashboardCodeForTest = dashboardCode;
