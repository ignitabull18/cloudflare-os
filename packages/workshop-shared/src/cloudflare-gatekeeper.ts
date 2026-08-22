// Cloudflare-gatekeeper-specific extension to the generic GatekeeperUser contract.
//
// The Cloudflare gatekeeper authenticates users (providesAuth) and, for the optional AI Gateway
// billing flow, lets the Workshop obtain a usable access token for the connected account. The
// Workshop holds the GatekeeperUser stub and narrows it to this interface to call the extra method.
// (More Cloudflare capabilities — Workers logs, R2, etc. — will be added here later.)

import { GatekeeperUser } from "./gatekeeper.js";

/** Availability of one metric in a Cloudflare dashboard snapshot. */
export type CloudflareDashboardMetricStatus = "ready" | "permission-required" | "unavailable";

/** A numeric metric shown in the Cloudflare operations dashboard. */
export interface CloudflareDashboardMetric {
  /** Stable key used by dashboard clients. */
  id: string;
  /** Human-readable metric name. */
  label: string;
  /** Numeric value, or null when the source could not be read. */
  value: number | null;
  /** How the value should be formatted. */
  unit: "count" | "bytes" | "percent" | "currency";
  /** Whether the value is current and readable. */
  status: CloudflareDashboardMetricStatus;
  /** Short explanation when the value is unavailable. */
  note?: string;
  /** Value for the immediately preceding equal-length period, when available. */
  previousValue?: number;
}

/** Supported lookback windows for the Cloudflare operations dashboard. */
export type CloudflareDashboardRange = "24h" | "7d" | "30d";

/** One bucket in the account-wide HTTP traffic trend. */
export interface CloudflareDashboardTrafficPoint {
  /** RFC 3339 bucket start. */
  timestamp: string;
  /** End-user HTTP requests observed in this bucket. */
  requests: number;
  /** Edge response bytes returned in this bucket. */
  bandwidth: number;
  /** Requests served from Cloudflare cache in this bucket. */
  cachedRequests: number;
  /** Requests whose edge response status was in the 5xx range. */
  errors: number;
}

/** Zone-level traffic summary used to find the account's highest-impact properties. */
export interface CloudflareDashboardZoneSummary {
  /** Stable Cloudflare zone ID. */
  id: string;
  /** Zone name. */
  name: string;
  /** Current Cloudflare zone status. */
  status: string;
  /** End-user requests during the selected period. */
  requests: number;
  /** Edge response bytes during the selected period. */
  bandwidth: number;
  /** Percentage of requests served from cache. */
  cacheHitRate: number;
  /** Percentage of requests ending in a 5xx response at Cloudflare's edge. */
  errorRate: number;
}

/** Ranked contribution to an analytical total, such as a zone, Worker, or security action. */
export interface CloudflareDashboardRankedValue {
  /** Stable source identifier. */
  id: string;
  /** Human-readable row label. */
  label: string;
  /** Primary volume represented by the row. */
  value: number;
  /** Optional related failure or exception volume. */
  secondaryValue?: number;
}

/** One Cloudflare account available through the connected OAuth grant. */
export interface CloudflareDashboardAccount {
  /** Stable Cloudflare account ID. */
  id: string;
  /** Account name shown in Cloudflare. */
  name: string;
}

/** A point-in-time, read-only overview of one Cloudflare account. */
export interface CloudflareDashboardSnapshot {
  /** Whether a Cloudflare account is connected. */
  connected: boolean;
  /** RFC 3339 timestamp when the snapshot was assembled. */
  generatedAt: string;
  /** Accounts visible to the OAuth grant. */
  accounts: CloudflareDashboardAccount[];
  /** Account represented by the metrics, when one was resolved. */
  account?: CloudflareDashboardAccount;
  /** True when the caller must choose among multiple accounts. */
  needsAccountSelection: boolean;
  /** Lookback window represented by the analytical metrics. */
  range: CloudflareDashboardRange;
  /** Start of the represented lookback window. */
  periodStart?: string;
  /** Number of zones whose analytics were successfully included. */
  analyticsZonesRead: number;
  /** Total number of zones the connected account exposed. */
  analyticsZonesTotal: number;
  /** Explanation when the analytical view has partial zone coverage. */
  analyticsNote?: string;
  /** Traffic, caching, and reliability metrics for the selected period. */
  headline: CloudflareDashboardMetric[];
  /** Account-wide time series aggregated from every accessible zone. */
  traffic: CloudflareDashboardTrafficPoint[];
  /** Zone summaries sorted by request volume. */
  zones: CloudflareDashboardZoneSummary[];
  /** Security events observed during the selected period. */
  securityEvents: CloudflareDashboardMetric;
  /** Security-event actions ranked by volume. */
  securityActions: CloudflareDashboardRankedValue[];
  /** Worker invocations observed during the selected period. */
  workerRequests: CloudflareDashboardMetric;
  /** Worker invocation errors observed during the selected period. */
  workerErrors: CloudflareDashboardMetric;
  /** Worker scripts ranked by invocation volume. */
  workers: CloudflareDashboardRankedValue[];
  /** Inventory counts across the account's major service families. */
  services: CloudflareDashboardMetric[];
}

/** Workshop-only extension implemented by the Cloudflare connected account. */
export interface CloudflareGatekeeperUser extends GatekeeperUser {
  // Returns a currently-usable (refreshed if needed) Cloudflare API access token for the connected
  // account, or null if the connection is broken/expired. Workshop-only — never exposed to gadgets
  // or agents. Used by the AI Gateway billing flow to read the credit balance and route BYOK
  // inference through the account's default AI Gateway.
  getUsableAccessToken(): Promise<string | null>;

  /** Returns a source-backed operational snapshot without exposing the OAuth token to the client. */
  getDashboardSnapshot(
    accountId?: string,
    range?: CloudflareDashboardRange,
  ): Promise<CloudflareDashboardSnapshot>;
}

/** Workshop-only extension implemented by a connection to Cloudflare's official API MCP. */
export interface CloudflareApiMcpUser extends GatekeeperUser {
  /**
   * Returns a read-only operational snapshot through fixed dashboard queries executed by the
   * official Cloudflare API MCP. Arbitrary MCP code is never accepted from the browser.
   */
  getCloudflareDashboardSnapshot(
    accountId?: string,
    range?: CloudflareDashboardRange,
  ): Promise<CloudflareDashboardSnapshot>;
}
