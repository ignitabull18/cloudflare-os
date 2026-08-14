import { describe, expect, it } from "vitest";
import { sandboxIdForDurableObject } from "./sandbox-id.js";

describe("sandboxIdForDurableObject", () => {
  it("keeps Cloudflare Durable Object ids within the Sandbox limit", () => {
    const id = "a".repeat(64);

    expect(sandboxIdForDurableObject(id)).toBe(`opencli-${"a".repeat(55)}`);
    expect(sandboxIdForDurableObject(id)).toHaveLength(63);
  });
});
