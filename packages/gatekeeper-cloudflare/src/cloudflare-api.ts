// Thin client over the Cloudflare REST API used by the gatekeeper: resolve the account's identity
// (email) and enumerate accounts. All calls use the user's OAuth access token.

import { VENDOR_ID } from "./vendor.js";
import { obsContext } from "./observability.js";
import type {
  CloudflareDashboardMetric,
  CloudflareDashboardRange,
  CloudflareDashboardRankedValue,
  CloudflareDashboardSnapshot,
  CloudflareDashboardTrafficPoint,
  CloudflareDashboardZoneSummary,
} from "@gadgets/workshop-shared/cloudflare-gatekeeper";

const API_BASE = "https://api.cloudflare.com/client/v4";

const logger = obsContext.createLogger({
  component: "gatekeeper.cloudflare", vendorId: VENDOR_ID,
});

interface CfEnvelope<T> {
  success: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
}

export class CloudflareApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

async function cfGet<T>(token: string, path: string): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
  });
  if (!resp.ok) {
    logger.error("cf-gatekeeper GET failed", {
      event: "cloudflare.api.get.failed",
      path, status: resp.status, statusText: resp.statusText,
    });
    resp.body?.cancel();
    throw new CloudflareApiError(`Cloudflare API request failed with status ${resp.status}.`, resp.status);
  }
  const data = await resp.json() as CfEnvelope<T>;
  if (!data.success || data.result === undefined) {
    const message = data.errors?.map(error => error.message).filter(Boolean).join("; ") ||
      "Cloudflare API returned an unsuccessful response.";
    throw new CloudflareApiError(message, resp.status);
  }
  return data.result;
}

async function cfPost<T>(token: string, path: string, body: unknown): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    logger.error("cf-gatekeeper POST failed", {
      event: "cloudflare.api.post.failed",
      path, status: resp.status, statusText: resp.statusText,
    });
    resp.body?.cancel();
    throw new CloudflareApiError(`Cloudflare API request failed with status ${resp.status}.`, resp.status);
  }
  return await resp.json() as T;
}

export interface CloudflareIdentity {
  // Cloudflare user id (stable).
  id: string;
  // Account email — verified by Cloudflare, so safe to use as a sign-in identity.
  email: string;
  displayName: string;
}

// Resolve the connected user's identity via the /user API (requires `user-details.read`). We use
// this rather than an OIDC userinfo endpoint because the dashboard OAuth client isn't permitted the
// `openid` scope. Returns null if the email is missing.
export async function fetchIdentity(token: string): Promise<CloudflareIdentity | null> {
  let r: { id?: string; email?: string; first_name?: string; last_name?: string };
  try {
    r = await cfGet(token, "/user");
  } catch {
    return null;
  }
  if (!r.id || !r.email) return null;
  const name = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
  return {
    id: String(r.id),
    email: r.email,
    displayName: name || r.email.split("@")[0],
  };
}

export interface CloudflareAccount {
  accountId: string;
  accountName: string;
}

// List the accounts the token can access. Requires `account-settings.read`.
export async function listAccounts(token: string): Promise<CloudflareAccount[]> {
  const result = await cfGet<Array<{ id: string; name: string }>>(token, "/accounts");
  return result.map((a) => ({ accountId: a.id, accountName: a.name }));
}

export interface CloudflareAccountDetails {
  id: string;
  name: string;
  type: "standard" | "enterprise";
  createdOn?: string;
}

export interface CloudflareWorker {
  name: string;
  createdOn?: string;
  modifiedOn?: string;
}

export interface CloudflareAiGateway {
  id: string;
  createdOn?: string;
  modifiedOn?: string;
}

export interface CloudflareR2Bucket {
  name: string;
  jurisdiction?: string;
  location?: string;
  createdOn?: string;
}

export interface CloudflareKvNamespace {
  id: string;
  title: string;
}

interface ZoneSummary {
  id: string;
  name: string;
  status: string;
}

interface ZoneAnalyticsResponse {
  data?: {
    viewer?: {
      zones?: Array<{
        all?: AnalyticsGroup[];
        cached?: AnalyticsGroup[];
        errors?: AnalyticsGroup[];
      }>;
    };
  };
  errors?: Array<{ message?: string }>;
}

interface SecurityAnalyticsResponse {
  data?: { viewer?: { zones?: Array<{ groups?: Array<{
    count?: number;
    dimensions?: { action?: string };
  }> }> } };
  errors?: Array<{ message?: string }>;
}

interface WorkersAnalyticsResponse {
  data?: { viewer?: { accounts?: Array<{ groups?: Array<{
    sum?: { requests?: number; errors?: number };
    dimensions?: { scriptName?: string; status?: string };
  }> }> } };
  errors?: Array<{ message?: string }>;
}

interface WorkersPeriodAnalytics {
  totals: { requests: number; errors: number };
  workers: CloudflareDashboardRankedValue[];
}

function throwGraphqlErrors(
  errors: Array<{ message?: string }> | undefined,
  fallback: string,
): void {
  if (!errors?.length) return;
  const message = errors.map(error => error.message).filter(Boolean).join("; ") || fallback;
  const permissionRelated = /permission|access denied|not authorized|does not have access/i.test(message);
  throw new CloudflareApiError(message, permissionRelated ? 403 : 400);
}

interface AnalyticsGroup {
  count?: number;
  sum?: { edgeResponseBytes?: number };
  dimensions?: { datetimeHour?: string };
}

interface TrafficTotals {
  requests: number;
  bytes: number;
  cachedRequests: number;
  errors: number;
}

interface ZonePeriodAnalytics {
  points: CloudflareDashboardTrafficPoint[];
  totals: TrafficTotals;
}

const RANGE_CONFIG: Record<CloudflareDashboardRange, {
  durationMs: number;
  bucketMs: number;
}> = {
  "24h": { durationMs: 24 * 60 * 60 * 1000, bucketMs: 60 * 60 * 1000 },
  "7d": { durationMs: 7 * 24 * 60 * 60 * 1000, bucketMs: 24 * 60 * 60 * 1000 },
  "30d": { durationMs: 30 * 24 * 60 * 60 * 1000, bucketMs: 24 * 60 * 60 * 1000 },
};

const emptyTotals = (): TrafficTotals => ({
  requests: 0, bytes: 0, cachedRequests: 0, errors: 0,
});

function addTotals(target: TrafficTotals, source: TrafficTotals): void {
  target.requests += source.requests;
  target.bytes += source.bytes;
  target.cachedRequests += source.cachedRequests;
  target.errors += source.errors;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator * 100 : 0;
}

const unavailableMetric = (id: string, label: string, unit: CloudflareDashboardMetric["unit"],
  error: unknown): CloudflareDashboardMetric => ({
  id,
  label,
  value: null,
  unit,
  status: error instanceof CloudflareApiError && error.isAuthError
    ? "permission-required"
    : "unavailable",
  note: error instanceof CloudflareApiError && error.isAuthError
    ? "Reconnect Cloudflare or confirm this dataset is available on your plan."
    : "Cloudflare did not return this metric.",
});

async function inventoryMetric(
  id: string,
  label: string,
  load: () => Promise<unknown[]>,
): Promise<CloudflareDashboardMetric> {
  try {
    return { id, label, value: (await load()).length, unit: "count", status: "ready" };
  } catch (error) {
    return unavailableMetric(id, label, "count", error);
  }
}

const encode = encodeURIComponent;

export class CloudflareApi {
  constructor(private readonly getToken: () => Promise<string>) {}

  async getAccount(accountId: string): Promise<CloudflareAccountDetails> {
    const token = await this.getToken();
    const account = await cfGet<{
      id: string; name: string; type: "standard" | "enterprise"; created_on?: string;
    }>(token, `/accounts/${encode(accountId)}`);
    return { id: account.id, name: account.name, type: account.type, createdOn: account.created_on };
  }

  async listWorkers(accountId: string): Promise<CloudflareWorker[]> {
    const token = await this.getToken();
    const workers = await cfGet<Array<{ id: string; created_on?: string; modified_on?: string }>>(
      token, `/accounts/${encode(accountId)}/workers/scripts`,
    );
    return workers.slice(0, 1000).map(worker => ({
      name: worker.id,
      createdOn: worker.created_on,
      modifiedOn: worker.modified_on,
    }));
  }

  async listAiGateways(accountId: string): Promise<CloudflareAiGateway[]> {
    const token = await this.getToken();
    const gateways = await cfGet<Array<{ id: string; created_at?: string; modified_at?: string }>>(
      token, `/accounts/${encode(accountId)}/ai-gateway/gateways?per_page=100`,
    );
    return gateways.map(gateway => ({
      id: gateway.id,
      createdOn: gateway.created_at,
      modifiedOn: gateway.modified_at,
    }));
  }

  async listR2Buckets(accountId: string): Promise<CloudflareR2Bucket[]> {
    const token = await this.getToken();
    const result = await cfGet<{ buckets: Array<{
      name: string; jurisdiction?: string; location?: string; creation_date?: string;
    }> }>(token, `/accounts/${encode(accountId)}/r2/buckets?per_page=1000`);
    return result.buckets.map(bucket => ({
      name: bucket.name,
      jurisdiction: bucket.jurisdiction,
      location: bucket.location,
      createdOn: bucket.creation_date,
    }));
  }

  async listKvNamespaces(accountId: string): Promise<CloudflareKvNamespace[]> {
    const token = await this.getToken();
    const namespaces = await cfGet<Array<{ id: string; title: string }>>(
      token, `/accounts/${encode(accountId)}/storage/kv/namespaces?per_page=1000`,
    );
    return namespaces.map(namespace => ({ id: namespace.id, title: namespace.title }));
  }

  async getDashboardSnapshot(
    accountId?: string,
    requestedRange: CloudflareDashboardRange = "24h",
  ): Promise<CloudflareDashboardSnapshot> {
    const range = requestedRange in RANGE_CONFIG ? requestedRange : "24h";
    const token = await this.getToken();
    const accounts = await listAccounts(token);
    const selected = accountId
      ? accounts.find(account => account.accountId === accountId)
      : accounts.length === 1 ? accounts[0] : undefined;
    if (accountId && !selected) throw new Error("The selected Cloudflare account is not accessible.");

    const base = {
      connected: true,
      generatedAt: new Date().toISOString(),
      accounts: accounts.map(account => ({ id: account.accountId, name: account.accountName })),
      needsAccountSelection: accounts.length > 1 && !selected,
      range,
    };
    if (!selected) return {
      ...base,
      analyticsZonesRead: 0,
      analyticsZonesTotal: 0,
      headline: [],
      traffic: [],
      zones: [],
      securityEvents: unavailableMetric("security-events", "Security events", "count", undefined),
      securityActions: [],
      workerRequests: unavailableMetric("worker-requests", "Worker requests", "count", undefined),
      workerErrors: unavailableMetric("worker-errors", "Worker errors", "count", undefined),
      workers: [],
      services: [],
    };

    const id = encode(selected.accountId);
    let zones: ZoneSummary[] = [];
    let zonesError: unknown;
    try {
      zones = await cfGet<ZoneSummary[]>(token, `/zones?account.id=${id}&per_page=50`);
    } catch (error) {
      zonesError = error;
    }

    const servicesPromise = Promise.all([
      zonesError
        ? Promise.resolve(unavailableMetric("zones", "Zones", "count", zonesError))
        : Promise.resolve({ id: "zones", label: "Zones", value: zones.length,
            unit: "count" as const, status: "ready" as const }),
      inventoryMetric("workers", "Workers", () => this.listWorkers(selected.accountId)),
      inventoryMetric("pages", "Pages projects", () =>
        cfGet<unknown[]>(token, `/accounts/${id}/pages/projects`)),
      inventoryMetric("d1", "D1 databases", () =>
        cfGet<unknown[]>(token, `/accounts/${id}/d1/database?per_page=100`)),
      inventoryMetric("r2", "R2 buckets", () => this.listR2Buckets(selected.accountId)),
      inventoryMetric("kv", "KV namespaces", () => this.listKvNamespaces(selected.accountId)),
      inventoryMetric("queues", "Queues", () =>
        cfGet<unknown[]>(token, `/accounts/${id}/queues?per_page=100`)),
      inventoryMetric("hyperdrive", "Hyperdrive configs", () =>
        cfGet<unknown[]>(token, `/accounts/${id}/hyperdrive/configs`)),
      inventoryMetric("vectorize", "Vectorize indexes", () =>
        cfGet<unknown[]>(token, `/accounts/${id}/vectorize/v2/indexes`)),
      inventoryMetric("ai-gateway", "AI Gateways", () => this.listAiGateways(selected.accountId)),
      inventoryMetric("access", "Access apps", () =>
        cfGet<unknown[]>(token, `/accounts/${id}/access/apps?per_page=100`)),
      inventoryMetric("tunnels", "Cloudflare Tunnels", () =>
        cfGet<unknown[]>(token, `/accounts/${id}/cfd_tunnel?is_deleted=false&per_page=100`)),
      inventoryMetric("turnstile", "Turnstile sites", () =>
        cfGet<unknown[]>(token, `/accounts/${id}/challenges/widgets`)),
      inventoryMetric("stream", "Stream videos", () =>
        cfGet<unknown[]>(token, `/accounts/${id}/stream?limit=1000`)),
    ]);

    const analyticsPromise = zones.length > 0
      ? this.#loadZoneAnalytics(token, zones, range, selected.accountId)
      : Promise.resolve({
          periodStart: undefined,
          analyticsZonesRead: 0,
          analyticsNote: zonesError ? "Zone analytics could not be read." : undefined,
          headline: [
            unavailableMetric("requests", "Requests", "count", zonesError),
            unavailableMetric("bandwidth", "Data transfer", "bytes", zonesError),
            unavailableMetric("cache-hit-rate", "Cache hit rate", "percent", zonesError),
            unavailableMetric("error-rate", "5xx error rate", "percent", zonesError),
          ],
          traffic: [] as CloudflareDashboardTrafficPoint[],
          zones: [] as CloudflareDashboardZoneSummary[],
          securityEvents: unavailableMetric("security-events", "Security events", "count", zonesError),
          securityActions: [] as CloudflareDashboardRankedValue[],
          workerRequests: unavailableMetric("worker-requests", "Worker requests", "count", zonesError),
          workerErrors: unavailableMetric("worker-errors", "Worker errors", "count", zonesError),
          workers: [] as CloudflareDashboardRankedValue[],
        });
    const [services, analytics] = await Promise.all([servicesPromise, analyticsPromise]);

    return {
      ...base,
      account: { id: selected.accountId, name: selected.accountName },
      periodStart: analytics.periodStart,
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
      services,
    };
  }

  async #loadZoneAnalytics(
    token: string,
    zones: ZoneSummary[],
    range: CloudflareDashboardRange,
    accountId: string,
  ): Promise<{
    periodStart: string;
    analyticsZonesRead: number;
    analyticsNote?: string;
    headline: CloudflareDashboardMetric[];
    traffic: CloudflareDashboardTrafficPoint[];
    zones: CloudflareDashboardZoneSummary[];
    securityEvents: CloudflareDashboardMetric;
    securityActions: CloudflareDashboardRankedValue[];
    workerRequests: CloudflareDashboardMetric;
    workerErrors: CloudflareDashboardMetric;
    workers: CloudflareDashboardRankedValue[];
  }> {
    const config = RANGE_CONFIG[range];
    const now = new Date();
    const endMs = config.bucketMs < 24 * 60 * 60 * 1000
      ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1)
      : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const start = new Date(endMs - config.durationMs);
    const end = new Date(endMs);
    const previousStart = new Date(start.getTime() - config.durationMs);

    const [results, securityResults, workersCurrent, workersPrevious] = await Promise.all([
      Promise.all(zones.map(async zone => {
        const [current, previous] = await Promise.allSettled([
        this.#queryZonePeriod(token, zone.id, start, end, config.bucketMs),
        this.#queryZonePeriod(token, zone.id, previousStart, start, config.bucketMs),
        ]);
        return { zone, current, previous };
      })),
      Promise.all(zones.map(zone => this.#queryZoneSecurity(token, zone.id, start, end)
        .then(value => ({ status: "fulfilled" as const, value }))
        .catch(reason => ({ status: "rejected" as const, reason })))),
      this.#queryWorkersPeriod(token, accountId, start, end)
        .then(value => ({ status: "fulfilled" as const, value }))
        .catch(reason => ({ status: "rejected" as const, reason })),
      this.#queryWorkersPeriod(token, accountId, previousStart, start)
        .then(value => ({ status: "fulfilled" as const, value }))
        .catch(reason => ({ status: "rejected" as const, reason })),
    ]);
    const readable = results.filter(result => result.current.status === "fulfilled");
    if (readable.length === 0) {
      const firstError = results.find(result => result.current.status === "rejected")?.current;
      const error = firstError?.status === "rejected" ? firstError.reason : new Error("No zone analytics available.");
      return {
        periodStart: start.toISOString(),
        analyticsZonesRead: 0,
        analyticsNote: "No zone analytics could be read for this period.",
        headline: [
          unavailableMetric("requests", "Requests", "count", error),
          unavailableMetric("bandwidth", "Data transfer", "bytes", error),
          unavailableMetric("cache-hit-rate", "Cache hit rate", "percent", error),
          unavailableMetric("error-rate", "5xx error rate", "percent", error),
        ],
        traffic: [],
        zones: [],
        securityEvents: unavailableMetric("security-events", "Security events", "count", error),
        securityActions: [],
        workerRequests: workersCurrent.status === "fulfilled"
          ? { id: "worker-requests", label: "Worker requests", value: workersCurrent.value.totals.requests,
              unit: "count", status: "ready" }
          : unavailableMetric("worker-requests", "Worker requests", "count", workersCurrent.reason),
        workerErrors: workersCurrent.status === "fulfilled"
          ? { id: "worker-errors", label: "Worker errors", value: workersCurrent.value.totals.errors,
              unit: "count", status: "ready" }
          : unavailableMetric("worker-errors", "Worker errors", "count", workersCurrent.reason),
        workers: workersCurrent.status === "fulfilled" ? workersCurrent.value.workers : [],
      };
    }

    const currentTotals = emptyTotals();
    const previousTotals = emptyTotals();
    const trafficByTime = new Map<string, CloudflareDashboardTrafficPoint>();
    const zoneSummaries: CloudflareDashboardZoneSummary[] = [];
    for (const result of readable) {
      const current = result.current.status === "fulfilled" ? result.current.value : undefined;
      if (!current) continue;
      addTotals(currentTotals, current.totals);
      for (const point of current.points) {
        const aggregate = trafficByTime.get(point.timestamp) ?? {
          timestamp: point.timestamp, requests: 0, bandwidth: 0, cachedRequests: 0, errors: 0,
        };
        aggregate.requests += point.requests;
        aggregate.bandwidth += point.bandwidth;
        aggregate.cachedRequests += point.cachedRequests;
        aggregate.errors += point.errors;
        trafficByTime.set(point.timestamp, aggregate);
      }
      zoneSummaries.push({
        id: result.zone.id,
        name: result.zone.name,
        status: result.zone.status,
        requests: current.totals.requests,
        bandwidth: current.totals.bytes,
        cacheHitRate: ratio(current.totals.cachedRequests, current.totals.requests),
        errorRate: ratio(current.totals.errors, current.totals.requests),
      });
      if (result.previous.status === "fulfilled") addTotals(previousTotals, result.previous.value.totals);
    }

    const metric = (
      id: string,
      label: string,
      unit: CloudflareDashboardMetric["unit"],
      value: number,
      previousValue?: number,
    ): CloudflareDashboardMetric => ({
      id, label, unit, value, ...(previousValue === undefined ? {} : { previousValue }), status: "ready",
    });
    const securityActions = new Map<string, number>();
    let securityEvents = 0;
    let readableSecurityZones = 0;
    for (const result of securityResults) {
      if (result.status !== "fulfilled") continue;
      readableSecurityZones++;
      for (const action of result.value) {
        securityEvents += action.value;
        securityActions.set(action.id, (securityActions.get(action.id) ?? 0) + action.value);
      }
    }
    const securityError = securityResults.find(result => result.status === "rejected");
    const securityMetric = readableSecurityZones > 0
      ? metric("security-events", "Security events", "count", securityEvents)
      : unavailableMetric("security-events", "Security events", "count",
          securityError?.status === "rejected" ? securityError.reason : undefined);
    const workerRequests = workersCurrent.status === "fulfilled"
      ? metric("worker-requests", "Worker requests", "count", workersCurrent.value.totals.requests,
          workersPrevious.status === "fulfilled" ? workersPrevious.value.totals.requests : undefined)
      : unavailableMetric("worker-requests", "Worker requests", "count", workersCurrent.reason);
    const workerErrors = workersCurrent.status === "fulfilled"
      ? metric("worker-errors", "Worker errors", "count", workersCurrent.value.totals.errors,
          workersPrevious.status === "fulfilled" ? workersPrevious.value.totals.errors : undefined)
      : unavailableMetric("worker-errors", "Worker errors", "count", workersCurrent.reason);
    return {
      periodStart: start.toISOString(),
      analyticsZonesRead: readable.length,
      analyticsNote: readable.length < zones.length
        ? `${readable.length} of ${zones.length} zones are included; unavailable zones were excluded.`
        : undefined,
      headline: [
        metric("requests", "Requests", "count", currentTotals.requests,
          readable.every(result => result.previous.status === "fulfilled") ? previousTotals.requests : undefined),
        metric("bandwidth", "Data transfer", "bytes", currentTotals.bytes,
          readable.every(result => result.previous.status === "fulfilled") ? previousTotals.bytes : undefined),
        metric("cache-hit-rate", "Cache hit rate", "percent",
          ratio(currentTotals.cachedRequests, currentTotals.requests),
          readable.every(result => result.previous.status === "fulfilled")
            ? ratio(previousTotals.cachedRequests, previousTotals.requests) : undefined),
        metric("error-rate", "5xx error rate", "percent",
          ratio(currentTotals.errors, currentTotals.requests),
          readable.every(result => result.previous.status === "fulfilled")
            ? ratio(previousTotals.errors, previousTotals.requests) : undefined),
      ],
      traffic: [...trafficByTime.values()].toSorted((a, b) => a.timestamp.localeCompare(b.timestamp)),
      zones: zoneSummaries.toSorted((a, b) => b.requests - a.requests),
      securityEvents: securityMetric,
      securityActions: [...securityActions.entries()]
        .map(([id, value]) => ({ id, label: id || "unknown", value }))
        .toSorted((a, b) => b.value - a.value),
      workerRequests,
      workerErrors,
      workers: workersCurrent.status === "fulfilled" ? workersCurrent.value.workers : [],
    };
  }

  async #queryZonePeriod(
    token: string,
    zoneTag: string,
    start: Date,
    end: Date,
    bucketMs: number,
  ): Promise<ZonePeriodAnalytics> {
    const query = `query DashboardZone($zoneTag: string!, $start: Time!, $end: Time!) {
      viewer { zones(filter: { zoneTag: $zoneTag }) {
        all: httpRequestsAdaptiveGroups(
          limit: 10000
          orderBy: [datetimeHour_ASC]
          filter: { datetime_geq: $start, datetime_lt: $end, requestSource: "eyeball" }
        ) { count sum { edgeResponseBytes } dimensions { datetimeHour } }
        cached: httpRequestsAdaptiveGroups(
          limit: 10000
          orderBy: [datetimeHour_ASC]
          filter: { datetime_geq: $start, datetime_lt: $end, requestSource: "eyeball", cacheStatus: "hit" }
        ) { count dimensions { datetimeHour } }
        errors: httpRequestsAdaptiveGroups(
          limit: 10000
          orderBy: [datetimeHour_ASC]
          filter: { datetime_geq: $start, datetime_lt: $end, requestSource: "eyeball",
            edgeResponseStatus_geq: 500, edgeResponseStatus_lt: 600 }
        ) { count dimensions { datetimeHour } }
      } }
    }`;
    const response = await cfPost<ZoneAnalyticsResponse>(token, "/graphql", {
      query,
      variables: { zoneTag, start: start.toISOString(), end: end.toISOString() },
    });
    throwGraphqlErrors(response.errors, "Cloudflare analytics query failed.");
    const zone = response.data?.viewer?.zones?.[0];
    if (!zone) throw new CloudflareApiError("Cloudflare returned no analytics for this zone.", 404);

    const byTime = new Map<string, CloudflareDashboardTrafficPoint>();
    const timestampFor = (group: AnalyticsGroup): string | undefined => {
      const value = group.dimensions?.datetimeHour;
      if (!value) return undefined;
      const date = new Date(value);
      const normalized = bucketMs >= 24 * 60 * 60 * 1000
        ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
        : Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours());
      return new Date(normalized).toISOString();
    };
    const pointFor = (timestamp: string): CloudflareDashboardTrafficPoint => {
      const existing = byTime.get(timestamp);
      if (existing) return existing;
      const point = { timestamp, requests: 0, bandwidth: 0, cachedRequests: 0, errors: 0 };
      byTime.set(timestamp, point);
      return point;
    };
    const totals = emptyTotals();
    for (const group of zone.all ?? []) {
      const requests = group.count ?? 0;
      const bytes = group.sum?.edgeResponseBytes ?? 0;
      totals.requests += requests;
      totals.bytes += bytes;
      const timestamp = timestampFor(group);
      if (timestamp) {
        const point = pointFor(timestamp);
        point.requests += requests;
        point.bandwidth += bytes;
      }
    }
    for (const group of zone.cached ?? []) {
      const count = group.count ?? 0;
      totals.cachedRequests += count;
      const timestamp = timestampFor(group);
      if (timestamp) pointFor(timestamp).cachedRequests += count;
    }
    for (const group of zone.errors ?? []) {
      const count = group.count ?? 0;
      totals.errors += count;
      const timestamp = timestampFor(group);
      if (timestamp) pointFor(timestamp).errors += count;
    }
    return { points: [...byTime.values()], totals };
  }

  async #queryZoneSecurity(
    token: string,
    zoneTag: string,
    start: Date,
    end: Date,
  ): Promise<CloudflareDashboardRankedValue[]> {
    const query = `query DashboardSecurity($zoneTag: string!, $start: Time!, $end: Time!) {
      viewer { zones(filter: { zoneTag: $zoneTag }) {
        groups: firewallEventsAdaptiveGroups(
          limit: 1000
          orderBy: [count_DESC]
          filter: { datetime_geq: $start, datetime_lt: $end }
        ) { count dimensions { action } }
      } }
    }`;
    const response = await cfPost<SecurityAnalyticsResponse>(token, "/graphql", {
      query,
      variables: { zoneTag, start: start.toISOString(), end: end.toISOString() },
    });
    throwGraphqlErrors(response.errors, "Cloudflare security analytics query failed.");
    const groups = response.data?.viewer?.zones?.[0]?.groups;
    if (!groups) throw new CloudflareApiError("Cloudflare returned no security analytics.", 404);
    return groups.map(group => {
      const action = group.dimensions?.action || "unknown";
      return { id: action, label: action, value: group.count ?? 0 };
    });
  }

  async #queryWorkersPeriod(
    token: string,
    accountTag: string,
    start: Date,
    end: Date,
  ): Promise<WorkersPeriodAnalytics> {
    const query = `query DashboardWorkers($accountTag: string!, $start: string!, $end: string!) {
      viewer { accounts(filter: { accountTag: $accountTag }) {
        groups: workersInvocationsAdaptive(
          limit: 10000
          filter: { datetime_geq: $start, datetime_lt: $end }
        ) {
          sum { requests errors }
          dimensions { scriptName status }
        }
      } }
    }`;
    const response = await cfPost<WorkersAnalyticsResponse>(token, "/graphql", {
      query,
      variables: { accountTag, start: start.toISOString(), end: end.toISOString() },
    });
    throwGraphqlErrors(response.errors, "Cloudflare Workers analytics query failed.");
    const groups = response.data?.viewer?.accounts?.[0]?.groups;
    if (!groups) throw new CloudflareApiError("Cloudflare returned no Workers analytics.", 404);
    const totals = { requests: 0, errors: 0 };
    const byScript = new Map<string, { requests: number; errors: number }>();
    for (const group of groups) {
      const requests = group.sum?.requests ?? 0;
      const errors = group.sum?.errors ?? 0;
      totals.requests += requests;
      totals.errors += errors;
      const scriptName = group.dimensions?.scriptName || "Unknown Worker";
      const script = byScript.get(scriptName) ?? { requests: 0, errors: 0 };
      script.requests += requests;
      script.errors += errors;
      byScript.set(scriptName, script);
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
        .toSorted((a, b) => b.value - a.value),
    };
  }
}
