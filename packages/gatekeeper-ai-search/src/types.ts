/** Options for one semantic search. */
export type SearchOptions = {
  /** Maximum number of matching chunks to return. Defaults to 8 and is capped at 20. */
  limit?: number;
  /** Minimum relevance score from zero to one. */
  threshold?: number;
};

/** One bounded, cited chunk returned by AI Search. */
export type SearchMatch = {
  /** Opaque chunk identifier. */
  id: string;
  /** Source document key or filename. */
  source: string;
  /** Relevance score from zero to one. */
  score: number;
  /** Matching document text, truncated to the gatekeeper response limit. */
  text: string;
};

/** A grounded answer plus the chunks used to produce it. */
export type SearchAnswer = {
  /** Generated answer text. */
  text: string;
  /** Source chunks returned by the retrieval stage. */
  sources: SearchMatch[];
};

/** Agent-facing, read-only AI Search capability. */
export interface AiSearchLibrary {
  /** Search the account's private indexed documents. */
  search(query: string, options?: SearchOptions): Promise<SearchMatch[]>;
  /** Generate an answer grounded in the account's private indexed documents. */
  answer(question: string, options?: SearchOptions): Promise<SearchAnswer>;
}

/** Management-page summary for one private AI Search library. */
export type LibrarySummary = {
  /** Stable private instance identifier. */
  instanceId: string;
  /** Current Cloudflare indexing state. */
  status?: string;
  /** Number of source objects in built-in storage. */
  objectCount: number;
  /** Documents in the first management page. */
  items: ManagedSearchItem[];
};

/** Document metadata shown in the management page. */
export type ManagedSearchItem = {
  /** Opaque item identifier. */
  id: string;
  /** Source filename. */
  name: string;
  /** Current indexing state. */
  status: string;
  /** Indexed chunk count when available. */
  chunks?: number;
  /** File size when available. */
  size?: number;
  /** Indexing error when Cloudflare reports one. */
  error?: string;
};
