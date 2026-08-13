/** A metadata value accepted by Supermemory. */
export type SupermemoryMetadataValue = string | number | boolean | string[];

/** Flat metadata attached to a memory, document, or connector. */
export type SupermemoryMetadata = Record<string, SupermemoryMetadataValue>;

/** A configured profile bucket. */
export interface SupermemoryProfileBucket {
  /** Stable bucket key. */
  key: string;
  /** Guidance describing what belongs in the bucket. */
  description: string;
}

/** Settings and identity for one isolated Supermemory space. */
export interface SupermemoryContainerInfo {
  /** Stable container tag used to isolate data. */
  containerTag: string;
  /** Optional display name. */
  name: string | null;
  /** Processing context applied to this space. */
  entityContext: string | null;
  /** Profile buckets configured specifically for this space. */
  profileBuckets: SupermemoryProfileBucket[];
  /** Creation time as an RFC 3339 timestamp, when available. */
  createdAt: string | null;
  /** Last update time as an RFC 3339 timestamp, when available. */
  updatedAt: string | null;
}

/** Editable settings for one Supermemory space. */
export interface SupermemoryContainerUpdate {
  /** New display name. */
  name?: string;
  /** New processing context, or null to clear it. */
  entityContext?: string | null;
  /** Replacement list of this space's profile buckets. */
  profileBuckets?: SupermemoryProfileBucket[];
}

/** Search modes supported by Supermemory. */
export type SupermemorySearchMode = "memories" | "hybrid" | "documents";

/** Options that refine a search or recall operation. */
export interface SupermemorySearchOptions {
  /** Search only memories, both memories and document chunks, or only document chunks. */
  mode?: SupermemorySearchMode;
  /** Maximum number of results, from 1 through 100. */
  limit?: number;
  /** Minimum similarity score from 0 through 1. */
  threshold?: number;
  /** Rerank results for improved relevance. */
  rerank?: boolean;
  /** Synthesize information across multiple matching memories. */
  aggregate?: boolean;
  /** Rewrite the query before retrieval. */
  rewriteQuery?: boolean;
}

/** One memory or document-chunk search match. */
export interface SupermemorySearchResult {
  /** Stable memory or chunk ID. */
  id: string;
  /** Kind of content returned. */
  kind: "memory" | "documentChunk";
  /** Matching text. */
  content: string;
  /** Similarity score from 0 through 1. */
  similarity: number;
  /** Attached metadata. */
  metadata: SupermemoryMetadata | null;
  /** Last update time as an RFC 3339 timestamp. */
  updatedAt: string;
  /** Memory version, when this is a memory result. */
  version?: number;
}

/** Maintained profile for one memory space. */
export interface SupermemoryProfile {
  /** Long-lived facts and preferences. */
  static: string[];
  /** Recent or changing context. */
  dynamic: string[];
  /** Memories grouped into configured buckets. */
  buckets: Record<string, string[]>;
}

/** A profile plus memories relevant to a question. */
export interface SupermemoryRecall {
  /** Maintained profile. */
  profile: SupermemoryProfile;
  /** Matches relevant to the question. */
  results: SupermemorySearchResult[];
}

/** Input for storing one explicit memory. */
export interface SupermemoryRememberInput {
  /** Fact, preference, or context to remember. */
  content: string;
  /** Whether the memory should remain stable rather than evolve dynamically. */
  isStatic?: boolean;
  /** Optional flat metadata. */
  metadata?: SupermemoryMetadata;
  /** Time after which Supermemory may forget this memory. */
  forgetAfter?: string | null;
  /** Human-readable reason for scheduled forgetting. */
  forgetReason?: string | null;
}

/** Current information about a memory entry. */
export interface SupermemoryMemoryInfo {
  /** Stable memory ID. */
  id: string;
  /** Current memory text. */
  content: string;
  /** Whether this is a static memory. */
  isStatic: boolean;
  /** Attached metadata. */
  metadata: SupermemoryMetadata | null;
  /** Current version number. */
  version: number;
  /** Creation time as an RFC 3339 timestamp. */
  createdAt: string;
  /** Last update time as an RFC 3339 timestamp. */
  updatedAt: string;
  /** Whether the memory has been forgotten. */
  isForgotten: boolean;
}

/** Changes used to create a corrected memory version. */
export interface SupermemoryMemoryUpdate {
  /** Corrected memory text. */
  content: string;
  /** Replacement metadata. */
  metadata?: SupermemoryMetadata;
  /** New forgetting time, or null to clear it. */
  forgetAfter?: string | null;
  /** New reason for scheduled forgetting. */
  forgetReason?: string | null;
}

/** One page of memory entries. */
export interface SupermemoryMemoryPage {
  /** Memory entries on this page. */
  memories: SupermemoryMemoryInfo[];
  /** Current one-based page number. */
  page: number;
  /** Total number of pages. */
  totalPages: number;
  /** Total number of entries. */
  totalItems: number;
}

/** Input for ingesting text or a URL. */
export interface SupermemoryDocumentInput {
  /** Plain text or a public URL to ingest. */
  content: string;
  /** Optional caller-defined stable ID. */
  customId?: string;
  /** Optional flat metadata. */
  metadata?: SupermemoryMetadata;
  /** Full memory extraction or document-oriented retrieval. */
  taskType?: "memory" | "superrag";
  /** Process independently now or dynamically with related documents. */
  processing?: "instant" | "dynamic";
}

/** Editable document fields. */
export interface SupermemoryDocumentUpdate {
  /** Replacement text or URL. */
  content?: string;
  /** Replacement caller-defined ID. */
  customId?: string;
  /** Replacement flat metadata. */
  metadata?: SupermemoryMetadata;
  /** Replacement processing task. */
  taskType?: "memory" | "superrag";
}

/** Current information about an ingested document. */
export interface SupermemoryDocumentInfo {
  /** Stable document ID. */
  id: string;
  /** Extracted title. */
  title: string | null;
  /** Processing status. */
  status: string;
  /** Detected document type. */
  type: string;
  /** Extracted summary. */
  summary: string | null;
  /** Attached metadata. */
  metadata: SupermemoryMetadata | null;
  /** Creation time as an RFC 3339 timestamp. */
  createdAt: string;
  /** Last update time as an RFC 3339 timestamp. */
  updatedAt: string;
}

/** One page of documents. */
export interface SupermemoryDocumentPage {
  /** Documents on this page. */
  documents: SupermemoryDocumentInfo[];
  /** Current one-based page number. */
  page: number;
  /** Total number of pages. */
  totalPages: number;
  /** Total number of documents. */
  totalItems: number;
}

/** Common options for paginated lists. */
export interface SupermemoryListOptions {
  /** One-based page number. */
  page?: number;
  /** Page size. */
  limit?: number;
  /** Sort direction. */
  order?: "asc" | "desc";
}

/** A Supermemory connector provider. */
export type SupermemoryConnectionProvider =
  | "notion" | "google-drive" | "onedrive" | "gmail" | "github" | "web-crawler" | "s3";

/** Current connector information. */
export interface SupermemoryConnectionInfo {
  /** Stable connection ID. */
  id: string;
  /** Connected provider. */
  provider: string;
  /** Provider account email, when available. */
  email: string | null;
  /** Container tags receiving synchronized content. */
  containerTags: string[];
  /** Maximum imported documents, when configured. */
  documentLimit: number | null;
  /** Creation time as an RFC 3339 timestamp. */
  createdAt: string;
  /** Last synchronization status, when available. */
  lastSyncStatus: string | null;
}

/** Input for starting a Supermemory connector. */
export interface SupermemoryConnectionInput {
  /** Provider to connect. */
  provider: SupermemoryConnectionProvider;
  /** Memory spaces that should receive synchronized content. */
  containerTags: string[];
  /** Maximum number of provider documents to import. */
  documentLimit?: number;
  /** Metadata added to imported documents. */
  metadata?: SupermemoryMetadata;
  /** Starting URL, required by the web crawler provider. */
  startUrl?: string;
}

/** Result of starting a connector flow. */
export interface SupermemoryConnectionSetup {
  /** New connection ID. */
  id: string;
  /** URL the user must open to authorize the provider, or null when authorization is unnecessary. */
  authorizationUrl: string | null;
  /** When the authorization URL expires, as reported by Supermemory. */
  expiresIn: string | null;
}

/** Provider-owned resource selectable for a connector. */
export interface SupermemoryConnectionResource {
  /** Provider-specific resource ID. */
  id: string | number;
  /** Human-readable resource name. */
  name: string;
  /** Provider-specific default branch, when applicable. */
  defaultBranch?: string;
}

/** One page of resources available to a connector. */
export interface SupermemoryConnectionResourcePage {
  /** Selectable resources. */
  resources: SupermemoryConnectionResource[];
  /** Total resource count when reported by the provider. */
  total: number;
}

/** Constraints for a newly issued container-scoped API key. */
export interface SupermemoryScopedKeyInput {
  /** The only memory space the key may access. */
  containerTag: string;
  /** Display name for the key. */
  name?: string;
  /** Expiration period from 1 through 365 days. */
  expiresInDays?: number;
  /** Maximum requests allowed per rate-limit window. */
  rateLimitMax?: number;
  /** Rate-limit window in milliseconds. */
  rateLimitTimeWindow?: number;
}

/** Metadata retained for a scoped key issued through this gatekeeper. */
export interface SupermemoryScopedKeyInfo {
  /** Stable key ID used for revocation. */
  id: string;
  /** Display name. */
  name: string;
  /** Container accessible through the key. */
  containerTag: string;
  /** Expiration time as an RFC 3339 timestamp, or null. */
  expiresAt: string | null;
  /** Whether this gatekeeper has revoked the key. */
  revoked: boolean;
}

/** A newly issued scoped key. The secret is returned only by the issuing call. */
export interface SupermemoryScopedKeySecret extends SupermemoryScopedKeyInfo {
  /** Bearer token to store in the target agent or Worker secret store. */
  key: string;
}

/** Settings visible for the connected Supermemory organization. */
export interface SupermemoryOrganizationSettings {
  /** Organization-level profile buckets, when configured. */
  profileBuckets: SupermemoryProfileBucket[];
}

/** Editable organization settings supported by this gatekeeper. */
export interface SupermemoryOrganizationSettingsUpdate {
  /** Replacement organization-level profile buckets. */
  profileBuckets?: SupermemoryProfileBucket[];
}

/** Access to one isolated Supermemory space. */
export interface SupermemoryContainer {
  /** Returns this memory space's settings and identity. */
  getInfo(): Promise<SupermemoryContainerInfo>;
  /** Updates this memory space's display and processing settings. */
  updateInfo(update: SupermemoryContainerUpdate): Promise<SupermemoryContainerInfo>;
  /** Returns the maintained profile for this memory space. */
  getProfile(): Promise<SupermemoryProfile>;
  /** Returns the profile together with memories relevant to a question. */
  recall(query: string, options?: SupermemorySearchOptions): Promise<SupermemoryRecall>;
  /** Searches memories, document chunks, or both. */
  search(query: string, options?: SupermemorySearchOptions): Promise<SupermemorySearchResult[]>;
  /** Lists memory entries in this space. */
  listMemories(options?: SupermemoryListOptions): Promise<SupermemoryMemoryPage>;
  /** Stores one explicit fact or preference in this space. */
  remember(input: SupermemoryRememberInput): Promise<SupermemoryMemory>;
  /** Opens a memory by stable ID within this space. */
  memory(id: string): Promise<SupermemoryMemory>;
  /** Lists documents ingested into this space. */
  listDocuments(options?: SupermemoryListOptions): Promise<SupermemoryDocumentPage>;
  /** Ingests text or a URL into this space. */
  addDocument(input: SupermemoryDocumentInput): Promise<SupermemoryDocument>;
  /** Opens a document by ID after confirming it belongs to this space. */
  document(id: string): Promise<SupermemoryDocument>;
}

/** Access to one memory entry. */
export interface SupermemoryMemory {
  /** Returns the latest version of this memory. */
  getInfo(): Promise<SupermemoryMemoryInfo>;
  /** Creates a corrected version of this memory. */
  update(input: SupermemoryMemoryUpdate): Promise<SupermemoryMemoryInfo>;
  /** Marks this memory as forgotten. */
  forget(reason?: string): Promise<void>;
}

/** Access to one ingested document. */
export interface SupermemoryDocument {
  /** Returns document metadata and processing status. */
  getInfo(): Promise<SupermemoryDocumentInfo>;
  /** Reprocesses the document with changed content or metadata. */
  update(input: SupermemoryDocumentUpdate): Promise<SupermemoryDocumentInfo>;
  /** Permanently deletes this document. */
  delete(): Promise<void>;
}

/** Administrative access to the connected Supermemory organization. */
export interface SupermemoryOrganization {
  /** Lists the organization's memory spaces. */
  listContainers(): Promise<SupermemoryContainerInfo[]>;
  /** Opens any container in the organization. */
  container(containerTag: string): Promise<SupermemoryContainer>;
  /** Lists source connectors, optionally limited to one memory space. */
  listConnections(containerTag?: string): Promise<SupermemoryConnectionInfo[]>;
  /** Starts a source connector and returns any authorization URL the user must open. */
  beginConnection(input: SupermemoryConnectionInput): Promise<SupermemoryConnectionSetup>;
  /** Opens a source connector by stable ID. */
  connection(id: string): Promise<SupermemoryConnection>;
  /** Issues a new container-scoped API key. */
  issueScopedKey(input: SupermemoryScopedKeyInput): Promise<SupermemoryScopedKeySecret>;
  /** Lists scoped keys previously issued through this gatekeeper. */
  listIssuedScopedKeys(): Promise<SupermemoryScopedKeyInfo[]>;
  /** Revokes a scoped API key without deleting its memories. */
  revokeScopedKey(id: string): Promise<void>;
  /** Returns supported organization settings. */
  getSettings(): Promise<SupermemoryOrganizationSettings>;
  /** Updates supported organization settings. */
  updateSettings(update: SupermemoryOrganizationSettingsUpdate): Promise<SupermemoryOrganizationSettings>;
}

/** Management access to one source connector. */
export interface SupermemoryConnection {
  /** Returns current connector information. */
  getInfo(): Promise<SupermemoryConnectionInfo>;
  /** Lists provider resources available for selection. */
  listResources(options?: SupermemoryListOptions): Promise<SupermemoryConnectionResourcePage>;
  /** Replaces the resources synchronized by providers that support resource selection. */
  configureResources(resources: SupermemoryConnectionResource[]): Promise<void>;
  /** Starts an on-demand synchronization. */
  sync(): Promise<void>;
  /** Disconnects the provider and optionally deletes imported documents. */
  disconnect(options?: { deleteImportedDocuments?: boolean }): Promise<void>;
}
