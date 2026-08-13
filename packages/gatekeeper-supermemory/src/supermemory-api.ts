import { createLogger } from "@gadgets/backend-utils/logger";
import type {
  SupermemoryConnectionInfo,
  SupermemoryContainerInfo,
  SupermemoryDocumentInfo,
  SupermemoryDocumentPage,
  SupermemoryListOptions,
  SupermemoryMemoryInfo,
  SupermemoryMemoryPage,
  SupermemoryMetadata,
  SupermemoryOrganizationSettings,
  SupermemoryProfile,
  SupermemorySearchOptions,
  SupermemorySearchResult,
} from "./types";

const API_BASE = "https://api.supermemory.ai";
type SupermemoryLogFields = {
  vendorId: string;
  method: string;
  path: string;
  status: number;
};
const logger = createLogger<SupermemoryLogFields>({
  component: "gatekeeper.supermemory",
  vendorId: "supermemory",
});

export class SupermemoryApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }

  get isAccessError(): boolean {
    return this.status === 401 || this.status === 403 || this.status === 404;
  }
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function metadata(value: unknown): SupermemoryMetadata | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as SupermemoryMetadata
    : null;
}

async function errorMessage(response: Response): Promise<string> {
  const generic = `Supermemory API request failed with status ${response.status}.`;
  try {
    const body = record(await response.json());
    const candidate = body.message ?? body.error ?? body.detail;
    return typeof candidate === "string" ? candidate.slice(0, 500) : generic;
  } catch {
    return generic;
  }
}

export class SupermemoryApi {
  constructor(private readonly getToken: () => Promise<string>) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getToken();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Accept", "application/json");
    if (init.body !== undefined) headers.set("Content-Type", "application/json");
    const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
    if (!response.ok) {
      logger.warn("Supermemory API request failed", {
        event: "supermemory.api.request.failed",
        method: init.method ?? "GET",
        path,
        status: response.status,
      });
      throw new SupermemoryApiError(await errorMessage(response), response.status);
    }
    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return undefined as T;
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async validateOrganizationKey(): Promise<void> {
    await this.request("/v3/container-tags/list");
  }

  async listContainers(): Promise<SupermemoryContainerInfo[]> {
    const list = await this.request<any[]>("/v3/container-tags/list");
    return list.map(item => {
      const value = record(item);
      return {
        containerTag: String(value.containerTag ?? value.id ?? ""),
        name: nullableString(value.name),
        entityContext: null,
        profileBuckets: [],
        createdAt: nullableString(value.createdAt),
        updatedAt: nullableString(value.updatedAt),
      };
    }).filter(item => item.containerTag.length > 0);
  }

  async getContainer(containerTag: string): Promise<SupermemoryContainerInfo> {
    const value = record(await this.request(
      `/v3/container-tags/${encodeURIComponent(containerTag)}`,
    ));
    return {
      containerTag: String(value.containerTag ?? containerTag),
      name: nullableString(value.name),
      entityContext: nullableString(value.entityContext),
      profileBuckets: Array.isArray(value.profileBuckets) ? value.profileBuckets : [],
      createdAt: nullableString(value.createdAt),
      updatedAt: nullableString(value.updatedAt),
    };
  }

  async updateContainer(containerTag: string, update: object): Promise<SupermemoryContainerInfo> {
    await this.request(`/v3/container-tags/${encodeURIComponent(containerTag)}`, {
      method: "PATCH",
      body: JSON.stringify(update),
    });
    return await this.getContainer(containerTag);
  }

  async getProfile(containerTag: string, query?: string, options: SupermemorySearchOptions = {}):
      Promise<{ profile: SupermemoryProfile; results: SupermemorySearchResult[] }> {
    const value = record(await this.request("/v4/profile", {
      method: "POST",
      body: JSON.stringify({
        containerTag,
        ...(query ? { q: query } : {}),
        ...(options.threshold === undefined ? {} : { threshold: options.threshold }),
      }),
    }));
    const profile = record(value.profile);
    const searchResults = record(value.searchResults);
    return {
      profile: {
        static: Array.isArray(profile.static) ? profile.static.map(String) : [],
        dynamic: Array.isArray(profile.dynamic) ? profile.dynamic.map(String) : [],
        buckets: record(profile.buckets) as Record<string, string[]>,
      },
      results: this.mapSearchResults(searchResults.results),
    };
  }

  async search(containerTag: string, query: string, options: SupermemorySearchOptions = {}):
      Promise<SupermemorySearchResult[]> {
    const value = record(await this.request("/v4/search", {
      method: "POST",
      body: JSON.stringify({
        q: query,
        containerTag,
        searchMode: options.mode ?? "hybrid",
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(options.threshold === undefined ? {} : { threshold: options.threshold }),
        ...(options.rerank === undefined ? {} : { rerank: options.rerank }),
        ...(options.aggregate === undefined ? {} : { aggregate: options.aggregate }),
        ...(options.rewriteQuery === undefined ? {} : { rewriteQuery: options.rewriteQuery }),
      }),
    }));
    return this.mapSearchResults(value.results);
  }

  private mapSearchResults(value: unknown): SupermemorySearchResult[] {
    if (!Array.isArray(value)) return [];
    return value.map(item => {
      const result = record(item);
      const isChunk = typeof result.chunk === "string";
      return {
        id: String(result.id ?? ""),
        kind: isChunk ? "documentChunk" as const : "memory" as const,
        content: String(result.chunk ?? result.memory ?? ""),
        similarity: Number(result.similarity ?? 0),
        metadata: metadata(result.metadata),
        updatedAt: String(result.updatedAt ?? ""),
        ...(typeof result.version === "number" ? { version: result.version } : {}),
      };
    });
  }

  async listMemories(containerTag: string, options: SupermemoryListOptions = {}):
      Promise<SupermemoryMemoryPage> {
    const value = record(await this.request("/v4/memories/list", {
      method: "POST",
      body: JSON.stringify({
        containerTags: [containerTag],
        page: options.page ?? 1,
        limit: options.limit ?? 50,
        order: options.order ?? "desc",
      }),
    }));
    const pagination = record(value.pagination);
    return {
      memories: Array.isArray(value.memoryEntries) ? value.memoryEntries.map(mapMemory) : [],
      page: Number(pagination.currentPage ?? options.page ?? 1),
      totalPages: Number(pagination.totalPages ?? 1),
      totalItems: Number(pagination.totalItems ?? 0),
    };
  }

  async getMemory(containerTag: string, id: string): Promise<SupermemoryMemoryInfo> {
    for (let page = 1; page <= 100; page++) {
      const result = await this.listMemories(containerTag, { page, limit: 100 });
      const found = result.memories.find(memory => memory.id === id);
      if (found) return found;
      if (page >= result.totalPages) break;
    }
    throw new SupermemoryApiError("Memory not found in the bound Supermemory space.", 404);
  }

  async remember(containerTag: string, input: object): Promise<string> {
    const value = record(await this.request("/v4/memories", {
      method: "POST",
      body: JSON.stringify({ containerTag, memories: [input] }),
    }));
    const created = Array.isArray(value.memories) ? record(value.memories[0]) : value;
    const id = created.id ?? (Array.isArray(value.ids) ? value.ids[0] : undefined);
    if (typeof id !== "string") throw new Error("Supermemory did not return the new memory ID.");
    return id;
  }

  async updateMemory(containerTag: string, id: string, input: Record<string, unknown>):
      Promise<SupermemoryMemoryInfo> {
    await this.getMemory(containerTag, id);
    await this.request("/v4/memories", {
      method: "PATCH",
      body: JSON.stringify({ id, containerTag, newContent: input.content, ...input, content: undefined }),
    });
    return await this.getMemory(containerTag, id);
  }

  async forgetMemory(containerTag: string, id: string, reason?: string): Promise<void> {
    await this.getMemory(containerTag, id);
    await this.request("/v4/memories", {
      method: "DELETE",
      body: JSON.stringify({ id, containerTag, ...(reason ? { reason } : {}) }),
    });
  }

  async listDocuments(containerTag: string, options: SupermemoryListOptions = {}):
      Promise<SupermemoryDocumentPage> {
    const value = record(await this.request("/v3/documents/list", {
      method: "POST",
      body: JSON.stringify({
        containerTags: [containerTag],
        page: options.page ?? 1,
        limit: options.limit ?? 50,
        order: options.order ?? "desc",
      }),
    }));
    const pagination = record(value.pagination);
    return {
      documents: Array.isArray(value.memories) ? value.memories.map(mapDocument) : [],
      page: Number(pagination.currentPage ?? options.page ?? 1),
      totalPages: Number(pagination.totalPages ?? 1),
      totalItems: Number(pagination.totalItems ?? 0),
    };
  }

  async addDocument(containerTag: string, input: Record<string, unknown>): Promise<string> {
    const value = record(await this.request("/v3/documents", {
      method: "POST",
      body: JSON.stringify({ ...input, containerTag, dreaming: input.processing, processing: undefined }),
    }));
    if (typeof value.id !== "string") throw new Error("Supermemory did not return the new document ID.");
    return value.id;
  }

  async getDocument(containerTag: string, id: string): Promise<SupermemoryDocumentInfo> {
    const value = record(await this.request(`/v3/documents/${encodeURIComponent(id)}`));
    const tags = Array.isArray(value.containerTags) ? value.containerTags.map(String) : [];
    if (tags.length > 0 && !tags.includes(containerTag)) {
      throw new SupermemoryApiError("Document is outside the bound Supermemory space.", 403);
    }
    if (tags.length === 0) {
      const listed = await this.listDocuments(containerTag, { page: 1, limit: 1100 });
      if (!listed.documents.some(document => document.id === id)) {
        throw new SupermemoryApiError("Document not found in the bound Supermemory space.", 404);
      }
    }
    return mapDocument(value);
  }

  async updateDocument(containerTag: string, id: string, input: object): Promise<SupermemoryDocumentInfo> {
    await this.getDocument(containerTag, id);
    await this.request(`/v3/documents/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ ...input, containerTag }),
    });
    return await this.getDocument(containerTag, id);
  }

  async deleteDocument(containerTag: string, id: string): Promise<void> {
    await this.getDocument(containerTag, id);
    await this.request(`/v3/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async listConnections(containerTag?: string): Promise<SupermemoryConnectionInfo[]> {
    const value = await this.request<any[]>("/v3/connections/list", {
      method: "POST",
      body: JSON.stringify(containerTag ? { containerTags: [containerTag] } : {}),
    });
    return value.map(mapConnection);
  }

  async getConnection(id: string): Promise<SupermemoryConnectionInfo> {
    return mapConnection(await this.request(`/v3/connections/${encodeURIComponent(id)}`));
  }

  async getSettings(): Promise<SupermemoryOrganizationSettings> {
    const value = record(await this.request("/v3/settings"));
    return { profileBuckets: Array.isArray(value.profileBuckets) ? value.profileBuckets : [] };
  }
}

function mapMemory(item: unknown): SupermemoryMemoryInfo {
  const value = record(item);
  return {
    id: String(value.id ?? ""),
    content: String(value.memory ?? value.content ?? ""),
    isStatic: Boolean(value.isStatic),
    metadata: metadata(value.metadata),
    version: Number(value.version ?? 1),
    createdAt: String(value.createdAt ?? ""),
    updatedAt: String(value.updatedAt ?? ""),
    isForgotten: Boolean(value.isForgotten),
  };
}

function mapDocument(item: unknown): SupermemoryDocumentInfo {
  const value = record(item);
  return {
    id: String(value.id ?? ""),
    title: nullableString(value.title),
    status: String(value.status ?? "unknown"),
    type: String(value.type ?? "unknown"),
    summary: nullableString(value.summary),
    metadata: metadata(value.metadata),
    createdAt: String(value.createdAt ?? ""),
    updatedAt: String(value.updatedAt ?? ""),
  };
}

function mapConnection(item: unknown): SupermemoryConnectionInfo {
  const value = record(item);
  return {
    id: String(value.id ?? ""),
    provider: String(value.provider ?? "unknown"),
    email: nullableString(value.email),
    containerTags: Array.isArray(value.containerTags) ? value.containerTags.map(String) : [],
    documentLimit: typeof value.documentLimit === "number" ? value.documentLimit : null,
    createdAt: String(value.createdAt ?? ""),
    lastSyncStatus: nullableString(record(value.lastSyncRun).status),
  };
}
