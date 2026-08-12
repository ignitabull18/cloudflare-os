import type { SearchMatch, SearchOptions } from "./types.js";

const DEFAULT_RESULT_LIMIT = 8;
const MAX_RESULT_LIMIT = 20;
const MAX_QUERY_LENGTH = 8_000;
const MAX_CHUNK_TEXT_LENGTH = 6_000;
const MAX_CHUNK_ID_LENGTH = 256;
const MAX_SOURCE_LENGTH = 1_000;

/** Validates and trims one agent query without retaining it. */
export function normalizeSearchInput(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty.`);
  if (normalized.length > MAX_QUERY_LENGTH) {
    throw new TypeError(`${label} exceeds ${MAX_QUERY_LENGTH} characters.`);
  }
  return normalized;
}

/** Clamps agent-controlled search options to the gatekeeper's response bounds. */
export function normalizeSearchOptions(options?: SearchOptions): Required<SearchOptions> {
  const requestedLimit = options?.limit ?? DEFAULT_RESULT_LIMIT;
  if (!Number.isFinite(requestedLimit)) throw new TypeError("Search limit must be finite.");
  const limit = Math.min(MAX_RESULT_LIMIT, Math.max(1, Math.floor(requestedLimit)));
  const threshold = options?.threshold ?? 0.4;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new TypeError("Search threshold must be between zero and one.");
  }
  return { limit, threshold };
}

/** Maps Cloudflare chunks into the bounded agent-facing citation shape. */
export function mapSearchMatches(
  chunks: AiSearchSearchResponse["chunks"],
  limit: number,
): SearchMatch[] {
  return chunks.slice(0, limit).map((chunk) => ({
    id: chunk.id.slice(0, MAX_CHUNK_ID_LENGTH),
    source: chunk.item.key.slice(0, MAX_SOURCE_LENGTH),
    score: Number.isFinite(chunk.score) ? Math.min(1, Math.max(0, chunk.score)) : 0,
    text: chunk.text.slice(0, MAX_CHUNK_TEXT_LENGTH),
  }));
}
