import type { CommandDescriptor } from "./driver.js";

export function shellQuote(value: string): string {
  if (value.includes("\0") || value.includes("\n") || value.includes("\r")) {
    throw new Error("OpenCLI arguments cannot contain control characters.");
  }
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function isCommandDescriptor(value: unknown): value is CommandDescriptor {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.command === "string" && typeof item.site === "string" &&
    typeof item.name === "string" && typeof item.description === "string" &&
    (item.access === "read" || item.access === "write") && typeof item.browser === "boolean" &&
    Array.isArray(item.args);
}
