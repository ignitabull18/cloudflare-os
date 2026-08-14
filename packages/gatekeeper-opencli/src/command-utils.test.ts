import { describe, expect, it } from "vitest";
import { isCommandDescriptor, shellQuote } from "./command-utils.js";

describe("OpenCLI command boundary", () => {
  it("quotes shell metacharacters as one argv token", () => {
    expect(shellQuote("it's; $(unsafe)")).toBe("'it'\\''s; $(unsafe)'");
  });

  it("rejects line breaks", () => {
    expect(() => shellQuote("safe\nnot-safe")).toThrow("control characters");
  });

  it("accepts only registered command-shaped catalog entries", () => {
    expect(isCommandDescriptor({ command: "github/repos", site: "github", name: "repos", description: "List repos", access: "read", browser: true, args: [] })).toBe(true);
    expect(isCommandDescriptor({ command: "github/repos", access: "admin" })).toBe(false);
  });
});
