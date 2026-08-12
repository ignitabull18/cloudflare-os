import { describe, expect, it } from "vitest";
import {
  mapSearchMatches,
  normalizeSearchInput,
  normalizeSearchOptions,
} from "../src/search-core.js";

describe("AI Search request bounds", () => {
  it("normalizes query text and clamps result counts", () => {
    expect(normalizeSearchInput("  revenue policy  ", "Query")).toBe("revenue policy");
    expect(normalizeSearchOptions({ limit: 100, threshold: 0.7 })).toEqual({
      limit: 20,
      threshold: 0.7,
    });
  });

  it("rejects empty queries and invalid thresholds", () => {
    expect(() => normalizeSearchInput("   ", "Query")).toThrow("cannot be empty");
    expect(() => normalizeSearchOptions({ threshold: 2 })).toThrow("between zero and one");
  });

  it("bounds returned chunks and preserves source citations", () => {
    const chunks = [
      { id: "one", type: "text", score: 0.9, text: "first", item: { key: "one.md" } },
      { id: "two", type: "text", score: 0.8, text: "second", item: { key: "two.md" } },
    ];
    expect(mapSearchMatches(chunks, 1)).toEqual([
      { id: "one", source: "one.md", score: 0.9, text: "first" },
    ]);
  });
});
