import { describe, expect, it } from "vitest";
import { boundToolLimit, stableComposioUserId } from "./composio-utils.js";

describe("Composio account boundary", () => {
  it("keeps tool searches bounded", () => {
    expect(boundToolLimit(0)).toBe(1);
    expect(boundToolLimit(12.8)).toBe(12);
    expect(boundToolLimit(500)).toBe(50);
  });

  it("maps one gatekeeper account to one stable Composio user", () => {
    expect(stableComposioUserId("abc")).toBe("cloudflare-os:abc");
  });
});
