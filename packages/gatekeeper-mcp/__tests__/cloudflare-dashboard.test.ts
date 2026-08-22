import { describe, expect, it, vi } from "vitest";

import {
  cloudflareAccountDiscoveryCodeForTest,
  cloudflareDashboardCodeForTest,
  getCloudflareMcpDashboardSnapshot,
} from "../src/cloudflare-dashboard.js";

type RequestOptions = {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  body?: { query?: string; variables?: Record<string, unknown> };
};

async function runCode(
  code: string,
  request: (options: RequestOptions) => Promise<unknown>,
  accountId = "account-1",
): Promise<unknown> {
  const cloudflare = { request };
  const fn = new Function("cloudflare", "accountId", `return (${code})()`) as
    (cloudflare: { request: typeof request }, accountId: string) => Promise<unknown>;
  return fn(cloudflare, accountId);
}

function dashboardData() {
  const unavailable = (id: string, label: string) => ({
    id, label, value: null, unit: "count", status: "unavailable",
  });
  return {
    periodStart: "2026-08-13T00:00:00.000Z",
    analyticsZonesRead: 0,
    analyticsZonesTotal: 0,
    headline: [],
    traffic: [],
    zones: [],
    securityEvents: unavailable("security-events", "Security events"),
    securityActions: [],
    workerRequests: unavailable("worker-requests", "Worker requests"),
    workerErrors: unavailable("worker-errors", "Worker errors"),
    workers: [],
    services: [],
  };
}

describe("Cloudflare API MCP dashboard adapter", () => {
  it("discovers accounts through a fixed account-independent GET", async () => {
    const request = vi.fn(async (options: RequestOptions) => {
      expect(options).toEqual({ method: "GET", path: "/accounts", query: { per_page: 50 } });
      return { result: [{ id: "account-1", name: "Ignitabull" }] };
    });

    await expect(runCode(cloudflareAccountDiscoveryCodeForTest, request))
      .resolves.toEqual([{ id: "account-1", name: "Ignitabull" }]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("runs the generated empty-zone snapshot using fixed read requests only", async () => {
    const methods: string[] = [];
    const request = vi.fn(async (options: RequestOptions) => {
      methods.push(options.method);
      if (options.path === "/zones") return { result: [] };
      if (options.path.endsWith("/r2/buckets")) return { result: { buckets: [{ name: "assets" }] } };
      return { result: [] };
    });

    const result = await runCode(cloudflareDashboardCodeForTest("24h"), request) as {
      analyticsZonesTotal: number;
      services: Array<{ id: string; value: number | null }>;
    };
    expect(result.analyticsZonesTotal).toBe(0);
    expect(result.services.find(metric => metric.id === "zones")?.value).toBe(0);
    expect(result.services.find(metric => metric.id === "r2")?.value).toBe(1);
    expect(methods.every(method => method === "GET")).toBe(true);
  });

  it("uses Cloudflare daily groups for 7-day and 30-day traffic windows", () => {
    const sevenDays = cloudflareDashboardCodeForTest("7d");
    const thirtyDays = cloudflareDashboardCodeForTest("30d");
    expect(sevenDays).toContain("httpRequests1dGroups");
    expect(thirtyDays).toContain("responseStatusMap");
    expect(sevenDays).toContain("date_geq: $start, date_lt: $end");
  });

  it("falls back from restricted firewall events to range-aligned threat rollups", () => {
    const oneDay = cloudflareDashboardCodeForTest("24h");
    const sevenDays = cloudflareDashboardCodeForTest("7d");
    expect(oneDay).toContain("httpRequests1hGroups");
    expect(oneDay).toContain("sum { threats }");
    expect(sevenDays).toContain("httpRequests1dGroups");
    expect(sevenDays).toContain('label: "Threats detected"');
  });

  it("assembles a selected-account snapshot with the account id scoped to execute", async () => {
    const execute = vi.fn(async (_code: string, accountId?: string) => {
      if (!accountId) return [{ id: "account-1", name: "Ignitabull" }];
      expect(accountId).toBe("account-1");
      return dashboardData();
    });

    const snapshot = await getCloudflareMcpDashboardSnapshot(execute, undefined, "7d");
    expect(snapshot.connected).toBe(true);
    expect(snapshot.account).toEqual({ id: "account-1", name: "Ignitabull" });
    expect(snapshot.range).toBe("7d");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("returns account selection without running account-scoped code", async () => {
    const execute = vi.fn(async () => [
      { id: "account-1", name: "One" },
      { id: "account-2", name: "Two" },
    ]);

    const snapshot = await getCloudflareMcpDashboardSnapshot(execute);
    expect(snapshot.needsAccountSelection).toBe(true);
    expect(snapshot.account).toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects an account id outside the connected MCP grant", async () => {
    const execute = vi.fn(async () => [{ id: "account-1", name: "One" }]);
    await expect(getCloudflareMcpDashboardSnapshot(execute, "account-2"))
      .rejects.toThrow("not accessible");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
