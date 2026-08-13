import type { RpcStub } from "cloudflare:workers";
import type { ActionDescription, ApprovalQueue } from "@gadgets/workshop-shared/gatekeeper";
import type { SupermemoryApi } from "./supermemory-api";
import type {
  SupermemoryConnectionInput,
  SupermemoryContainerUpdate,
  SupermemoryDocumentInput,
  SupermemoryDocumentUpdate,
  SupermemoryMemoryUpdate,
  SupermemoryOrganizationSettingsUpdate,
  SupermemoryRememberInput,
  SupermemoryScopedKeyInfo,
  SupermemoryScopedKeyInput,
} from "./types";

export type SupermemoryAction =
  | { type: "updateContainer"; containerTag: string; update: SupermemoryContainerUpdate }
  | { type: "remember"; containerTag: string; input: SupermemoryRememberInput; provisionalId: string }
  | { type: "updateMemory"; containerTag: string; memoryId: string; input: SupermemoryMemoryUpdate }
  | { type: "forgetMemory"; containerTag: string; memoryId: string; reason?: string }
  | { type: "addDocument"; containerTag: string; input: SupermemoryDocumentInput; provisionalId: string }
  | { type: "updateDocument"; containerTag: string; documentId: string; input: SupermemoryDocumentUpdate }
  | { type: "deleteDocument"; containerTag: string; documentId: string }
  | { type: "beginConnection"; input: SupermemoryConnectionInput; provisionalId: string }
  | { type: "configureConnection"; connectionId: string; resources: Array<{
      id: string | number; name: string; defaultBranch?: string;
    }> }
  | { type: "syncConnection"; connectionId: string }
  | { type: "disconnectConnection"; connectionId: string; deleteImportedDocuments: boolean }
  | { type: "issueScopedKey"; input: SupermemoryScopedKeyInput; provisionalId: string }
  | { type: "revokeScopedKey"; keyId: string }
  | { type: "updateSettings"; update: SupermemoryOrganizationSettingsUpdate };

export type SupermemoryActionResult = {
  realId?: string;
  authorizationUrl?: string | null;
  expiresIn?: string | null;
  scopedKey?: SupermemoryScopedKeyInfo;
  scopedKeySecret?: string;
};

export type StoredSupermemoryAction = {
  id: number;
  action: SupermemoryAction;
  state: "pending" | "applied" | "reverted";
  submittedAt: number;
  appliedAt?: number;
  result?: SupermemoryActionResult;
};

type Kv = DurableObjectStorage["kv"];
type CacheRecord<T> = { fetchedAt: number; value: T };

export interface ScopedKeyRegistry {
  saveScopedKey(info: SupermemoryScopedKeyInfo): Promise<void>;
  markScopedKeyRevoked(id: string): Promise<void>;
}

export class SupermemoryStore {
  constructor(readonly kv: Kv, readonly api: SupermemoryApi, readonly scopedKeys: ScopedKeyRegistry) {}

  nextActionId(): number {
    const id = this.kv.get<number>("seq:action") ?? 1;
    this.kv.put("seq:action", id + 1);
    return id;
  }

  nextProvisionalId(kind: "memory" | "document" | "connection" | "key"): string {
    const value = this.kv.get<number>(`seq:${kind}`) ?? 1;
    this.kv.put(`seq:${kind}`, value + 1);
    return `~${kind}:${value}`;
  }

  putAction(record: StoredSupermemoryAction): void {
    this.kv.put(`action:${record.id}`, record);
  }

  getAction(id: number): StoredSupermemoryAction | undefined {
    return this.kv.get<StoredSupermemoryAction>(`action:${id}`);
  }

  deleteAction(id: number): void {
    this.kv.delete(`action:${id}`);
  }

  actions(): StoredSupermemoryAction[] {
    return [...this.kv.list<StoredSupermemoryAction>({ prefix: "action:" })]
      .map(([, record]) => record)
      .toSorted((a, b) => a.id - b.id);
  }

  pendingActions(): StoredSupermemoryAction[] {
    return this.actions().filter(record => record.state === "pending");
  }

  actionForProvisional(provisionalId: string): StoredSupermemoryAction | undefined {
    return this.actions().find(record => "provisionalId" in record.action &&
      record.action.provisionalId === provisionalId);
  }

  mapProvisional(provisionalId: string, realId: string): void {
    this.kv.put(`provisional:${provisionalId}`, realId);
  }

  resolveId(id: string): string {
    return id.startsWith("~") ? this.kv.get<string>(`provisional:${id}`) ?? id : id;
  }

  async cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const stored = this.kv.get<CacheRecord<T>>(`cache:${key}`);
    if (stored && Date.now() - stored.fetchedAt < ttlMs) return stored.value;
    const value = await load();
    this.kv.put<CacheRecord<T>>(`cache:${key}`, { fetchedAt: Date.now(), value });
    return value;
  }

  clearCache(): void {
    for (const [key] of this.kv.list({ prefix: "cache:" })) this.kv.delete(key);
  }
}

export function describeSupermemoryAction(action: SupermemoryAction): ActionDescription {
  switch (action.type) {
    case "updateContainer":
      return description(`Update Supermemory space ${action.containerTag}`,
        `Change settings for the isolated memory space \`${action.containerTag}\`.`);
    case "remember":
      return description(`Remember in ${action.containerTag}`,
        `Store a new ${action.input.isStatic ? "static " : ""}memory in \`${action.containerTag}\`: ${preview(action.input.content)}`,
        true);
    case "updateMemory":
      return description("Correct a Supermemory memory",
        `Create a corrected version of memory \`${action.memoryId}\` in \`${action.containerTag}\`: ${preview(action.input.content)}`);
    case "forgetMemory":
      return description("Forget a Supermemory memory",
        `Forget memory \`${action.memoryId}\` in \`${action.containerTag}\`${action.reason ? ` because ${preview(action.reason)}` : ""}.`);
    case "addDocument":
      return description(`Ingest document into ${action.containerTag}`,
        `Ingest ${preview(action.input.content)} into \`${action.containerTag}\`.`, true);
    case "updateDocument":
      return description("Update a Supermemory document",
        `Reprocess document \`${action.documentId}\` in \`${action.containerTag}\`.`);
    case "deleteDocument":
      return description("Delete a Supermemory document",
        `Permanently delete document \`${action.documentId}\` from \`${action.containerTag}\`.`);
    case "beginConnection":
      return description(`Connect ${action.input.provider} to Supermemory`,
        `Create a ${action.input.provider} source connector for ${action.input.containerTags.map(tag => `\`${tag}\``).join(", ")}.`, true);
    case "configureConnection":
      return description("Configure Supermemory connector resources",
        `Replace the selected resources for connector \`${action.connectionId}\` with ${action.resources.length} resource(s).`);
    case "syncConnection":
      return description("Synchronize a Supermemory connector",
        `Start an on-demand synchronization for connector \`${action.connectionId}\`.`);
    case "disconnectConnection":
      return description("Disconnect a Supermemory source",
        `Disconnect connector \`${action.connectionId}\`${action.deleteImportedDocuments ? " and permanently delete its imported documents" : " while keeping imported documents"}.`);
    case "issueScopedKey":
      return description(`Issue key for ${action.input.containerTag}`,
        `Create a scoped API key limited to \`${action.input.containerTag}\`${action.input.expiresInDays ? ` for ${action.input.expiresInDays} day(s)` : ""}.`, true);
    case "revokeScopedKey":
      return description("Revoke a Supermemory scoped key",
        `Revoke scoped key \`${action.keyId}\` without deleting its memories.`);
    case "updateSettings":
      return description("Update Supermemory organization settings",
        "Change supported organization-wide profile settings.");
  }
}

function description(title: string, text: string, implementsRevert = false): ActionDescription {
  return { title, description: text, implementsRevert };
}

function preview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return JSON.stringify(normalized.length > 180 ? `${normalized.slice(0, 180)}…` : normalized);
}

export async function stageSupermemoryAction(
  store: SupermemoryStore,
  queue: RpcStub<ApprovalQueue>,
  action: SupermemoryAction,
): Promise<number> {
  const id = store.nextActionId();
  store.putAction({ id, action, state: "pending", submittedAt: Date.now() });
  try {
    await queue.submitAction(id, describeSupermemoryAction(action));
  } catch (error) {
    store.deleteAction(id);
    throw error;
  }
  return id;
}

function requireResolved(store: SupermemoryStore, id: string): string {
  const resolved = store.resolveId(id);
  if (resolved.startsWith("~")) throw new Error(`Dependency ${id} has not been applied yet.`);
  return resolved;
}

export async function applySupermemoryAction(store: SupermemoryStore, id: number): Promise<void> {
  const record = store.getAction(id);
  if (!record || record.state !== "pending") throw new Error(`Unknown pending Supermemory action: ${id}`);
  const action = record.action;
  let result: SupermemoryActionResult | undefined;
  switch (action.type) {
    case "updateContainer":
      await store.api.updateContainer(action.containerTag, action.update);
      break;
    case "remember": {
      const realId = await store.api.remember(action.containerTag, action.input);
      store.mapProvisional(action.provisionalId, realId);
      result = { realId };
      break;
    }
    case "updateMemory":
      await store.api.updateMemory(action.containerTag, requireResolved(store, action.memoryId),
        action.input as unknown as Record<string, unknown>);
      break;
    case "forgetMemory":
      await store.api.forgetMemory(action.containerTag, requireResolved(store, action.memoryId), action.reason);
      break;
    case "addDocument": {
      const realId = await store.api.addDocument(action.containerTag,
        action.input as unknown as Record<string, unknown>);
      store.mapProvisional(action.provisionalId, realId);
      result = { realId };
      break;
    }
    case "updateDocument":
      await store.api.updateDocument(action.containerTag, requireResolved(store, action.documentId), action.input);
      break;
    case "deleteDocument":
      await store.api.deleteDocument(action.containerTag, requireResolved(store, action.documentId));
      break;
    case "beginConnection": {
      const metadata = {
        ...action.input.metadata,
        ...(action.input.startUrl ? { startUrl: action.input.startUrl } : {}),
      };
      const value = await store.api.request<Record<string, unknown>>(
        `/v3/connections/${encodeURIComponent(action.input.provider)}`,
        { method: "POST", body: JSON.stringify({
          containerTags: action.input.containerTags,
          ...(action.input.documentLimit === undefined ? {} : {
            documentLimit: action.input.documentLimit,
          }),
          ...(Object.keys(metadata).length ? { metadata } : {}),
          redirectUrl: "https://console.supermemory.ai/",
        }) },
      );
      const realId = String(value.id);
      store.mapProvisional(action.provisionalId, realId);
      result = {
        realId,
        authorizationUrl: typeof value.authLink === "string" ? value.authLink : null,
        expiresIn: typeof value.expiresIn === "string" ? value.expiresIn : null,
      };
      break;
    }
    case "configureConnection":
      await store.api.request(`/v3/connections/${encodeURIComponent(requireResolved(store, action.connectionId))}/configure`, {
        method: "POST", body: JSON.stringify({ resources: action.resources }),
      });
      break;
    case "syncConnection": {
      const connectionId = requireResolved(store, action.connectionId);
      const info = await store.api.getConnection(connectionId);
      const creation = store.actionForProvisional(action.connectionId);
      const containerTags = info.containerTags.length > 0
        ? info.containerTags
        : creation?.action.type === "beginConnection"
          ? creation.action.input.containerTags
          : [];
      if (containerTags.length === 0) {
        throw new Error(`Supermemory connector ${connectionId} has no assigned spaces.`);
      }
      await store.api.request(`/v3/connections/${encodeURIComponent(info.provider)}/import`, {
        method: "POST", body: JSON.stringify({ containerTags }),
      });
      break;
    }
    case "disconnectConnection":
      await store.api.request(
        `/v3/connections/${encodeURIComponent(requireResolved(store, action.connectionId))}` +
        `?deleteDocuments=${action.deleteImportedDocuments}`,
        { method: "DELETE" },
      );
      break;
    case "issueScopedKey": {
      const value = await store.api.request<Record<string, unknown>>("/v3/auth/scoped-key", {
        method: "POST", body: JSON.stringify(action.input),
      });
      const info: SupermemoryScopedKeyInfo = {
        id: String(value.id),
        name: String(value.name ?? action.input.name ?? `scoped_${action.input.containerTag}`),
        containerTag: String(value.containerTag ?? action.input.containerTag),
        expiresAt: typeof value.expiresAt === "string" ? value.expiresAt : null,
        revoked: false,
      };
      const secret = String(value.key);
      store.mapProvisional(action.provisionalId, info.id);
      await store.scopedKeys.saveScopedKey(info);
      result = { realId: info.id, scopedKey: info, scopedKeySecret: secret };
      break;
    }
    case "revokeScopedKey":
      await store.api.request(`/v3/auth/scoped-key/${encodeURIComponent(requireResolved(store, action.keyId))}`,
        { method: "DELETE" });
      await store.scopedKeys.markScopedKeyRevoked(requireResolved(store, action.keyId));
      break;
    case "updateSettings":
      await store.api.request("/v3/settings", { method: "PATCH", body: JSON.stringify(action.update) });
      break;
  }
  record.state = "applied";
  record.appliedAt = Date.now();
  record.result = result;
  store.putAction(record);
  store.clearCache();
}

export function rejectSupermemoryAction(store: SupermemoryStore, id: number): { restart?: boolean } | void {
  const record = store.getAction(id);
  if (!record) return;
  store.deleteAction(id);
  return "provisionalId" in record.action ? { restart: true } : undefined;
}

export async function revertSupermemoryAction(
  store: SupermemoryStore,
  id: number,
): Promise<void | { message?: string; canRetry?: boolean; restart?: boolean }> {
  const record = store.getAction(id);
  if (!record || record.state !== "applied") throw new Error(`Unknown applied Supermemory action: ${id}`);
  const result = record.result;
  switch (record.action.type) {
    case "remember":
      await store.api.forgetMemory(record.action.containerTag, requireResolved(store, record.action.provisionalId),
        "Reverted by Cloudflare OS");
      break;
    case "addDocument":
      await store.api.deleteDocument(record.action.containerTag,
        requireResolved(store, record.action.provisionalId));
      break;
    case "beginConnection":
      await store.api.request(
        `/v3/connections/${encodeURIComponent(requireResolved(store, record.action.provisionalId))}` +
        "?deleteDocuments=false",
        { method: "DELETE" },
      );
      break;
    case "issueScopedKey":
      await store.api.request(`/v3/auth/scoped-key/${encodeURIComponent(requireResolved(store, record.action.provisionalId))}`,
        { method: "DELETE" });
      if (result?.scopedKey) await store.scopedKeys.markScopedKeyRevoked(result.scopedKey.id);
      break;
    default:
      return { message: "This Supermemory action cannot be automatically reverted." };
  }
  record.state = "reverted";
  if (record.result) record.result.scopedKeySecret = undefined;
  store.putAction(record);
  store.clearCache();
}

export function takeScopedKeySecret(store: SupermemoryStore, provisionalId: string):
    { info: SupermemoryScopedKeyInfo; key: string } | null {
  const record = store.actionForProvisional(provisionalId);
  if (!record?.result?.scopedKey || !record.result.scopedKeySecret) return null;
  const value = { info: record.result.scopedKey, key: record.result.scopedKeySecret };
  record.result.scopedKeySecret = undefined;
  store.putAction(record);
  return value;
}
