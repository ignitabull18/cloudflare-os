import { DurableObject, RpcStub, RpcTarget, WorkerEntrypoint } from "cloudflare:workers";
import { skipRpcValidation, validateRpc } from "capnweb-validate";
import {
  stripTrailingSlashes,
  type AccountDescription,
  type ApprovalQueue,
  type Gatekeeper,
  type GatekeeperConnectCallback,
  type GatekeeperUser,
  type GatekeeperUserVerifier,
  type GatekeeperVendor as GatekeeperVendorIface,
  type ResourceConfiguratorFrame,
  type ResourceDescription,
  type SupportedResource,
  type VendorDescription,
} from "@gadgets/workshop-shared/gatekeeper";
import { connectFormHtml } from "./connect-form.js";
import {
  SupermemoryApi,
  SupermemoryApiError,
} from "./supermemory-api.js";
import type {
  SupermemoryConnection,
  SupermemoryConnectionInfo,
  SupermemoryConnectionInput,
  SupermemoryConnectionResource,
  SupermemoryConnectionResourcePage,
  SupermemoryConnectionSetup,
  SupermemoryContainer,
  SupermemoryContainerInfo,
  SupermemoryContainerUpdate,
  SupermemoryDocument,
  SupermemoryDocumentInfo,
  SupermemoryDocumentInput,
  SupermemoryDocumentPage,
  SupermemoryDocumentUpdate,
  SupermemoryListOptions,
  SupermemoryMemory,
  SupermemoryMemoryInfo,
  SupermemoryMemoryPage,
  SupermemoryMemoryUpdate,
  SupermemoryOrganization,
  SupermemoryOrganizationSettings,
  SupermemoryOrganizationSettingsUpdate,
  SupermemoryProfile,
  SupermemoryRecall,
  SupermemoryRememberInput,
  SupermemoryScopedKeyInfo,
  SupermemoryScopedKeyInput,
  SupermemoryScopedKeyIssuance,
  SupermemoryScopedKeySecret,
  SupermemorySearchOptions,
  SupermemorySearchResult,
} from "./types";
import {
  SupermemoryStore,
  applySupermemoryAction,
  rejectSupermemoryAction,
  revertSupermemoryAction,
  stageSupermemoryAction,
  takeScopedKeySecret,
  type SupermemoryAction,
} from "./supermemory-actions.js";
import type { SupermemoryContainerConfiguratorRpc } from "./configurator/container-configurator-types";
import type { SupermemoryOrganizationConfiguratorRpc } from "./configurator/organization-configurator-types";
import TYPES_CODE from "./types.txt";
import CONTAINER_CONFIGURATOR_HTML from "./generated/container-configurator-ui.txt";
import ORGANIZATION_CONFIGURATOR_HTML from "./generated/organization-configurator-ui.txt";

const NONCE_BYTES = 32;
const NONCE_LIFETIME_MS = 10 * 60 * 1000;
const CONTAINER_TAG_RE = /^[A-Za-z0-9_.:-]{1,100}$/;

const LOGO_URL = "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
  `<rect width="64" height="64" rx="15" fill="#6d28d9"/>` +
  `<path d="M17 39c0-12 8-20 20-20 5 0 9 1 12 4l-7 8c-2-2-4-3-7-3-5 0-9 4-9 10 0 5 3 8 8 8 3 0 6-1 8-3v-4h-9v-8h18v17c-5 5-11 7-18 7-10 0-16-6-16-16Z" fill="white"/>` +
  `</svg>`,
);

const CONTAINER_RESOURCE: SupportedResource = {
  urlPattern: "https://api.supermemory.ai/v3/container-tags/:containerTag",
  title: "Supermemory Space",
  description: "Read and write memories and documents in one isolated Supermemory container.",
  icon: { url: LOGO_URL },
};

const ORGANIZATION_RESOURCE: SupportedResource = {
  urlPattern: "https://console.supermemory.ai/",
  title: "Supermemory Organization",
  description: "Manage containers, scoped API keys, and synchronized source connectors.",
  icon: { url: LOGO_URL },
};

const SUPPORTED_RESOURCES = [CONTAINER_RESOURCE, ORGANIZATION_RESOURCE];

type Env = Cloudflare.Env & { BASE_URL?: string };
type StoredCredentials = { apiKey: string; defaultContainerTag: string };
type StoredNonce = { value: string; expiresAt: number };
type CompleteConnectionResult =
  | { kind: "ok" }
  | { kind: "invalid_nonce" }
  | { kind: "error"; message: string };

function getBaseUrl(env: Env): string {
  return stripTrailingSlashes(env.BASE_URL ?? "http://localhost:8787/gatekeeper/supermemory");
}

function getBasePath(env: Env): string {
  const path = new URL(getBaseUrl(env)).pathname;
  return path === "/" ? "" : path;
}

function hexEncode(bytes: Uint8Array): string {
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function generateNonce(): string {
  return hexEncode(crypto.getRandomValues(new Uint8Array(NONCE_BYTES)));
}

function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aa = encoder.encode(a);
  const bb = encoder.encode(b);
  return aa.byteLength === bb.byteLength && crypto.subtle.timingSafeEqual(aa, bb);
}

function requireContainerTag(containerTag: string): string {
  const value = containerTag.trim();
  if (!CONTAINER_TAG_RE.test(value)) {
    throw new Error("Container tags must be 1-100 letters, numbers, dots, colons, underscores, or hyphens.");
  }
  return value;
}

const INVALID_LINK_HTML = `<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:3rem">
<h1>Connection link expired</h1><p>Return to Cloudflare OS and start the Supermemory connection again.</p>
</body></html>`;
const SELF_CLOSING_HTML = `<!DOCTYPE html><html><body><script>window.close()</script>
<p>Supermemory connected. You may close this tab.</p></body></html>`;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const basePath = getBasePath(env);
    if (!url.pathname.startsWith(`${basePath}/`)) return new Response("Not Found", { status: 404 });
    const path = url.pathname.slice(basePath.length + 1).split("/");
    if (path.length !== 2 || path[0].length !== 64 || path[1].length !== NONCE_BYTES * 2) {
      return new Response("Not Found", { status: 404 });
    }
    const account = ctx.exports.UserAccount.get(ctx.exports.UserAccount.idFromString(path[0]));
    if (request.method === "GET") {
      if (!await account.verifyNonceWithoutConsuming(path[1])) {
        return new Response(INVALID_LINK_HTML, { status: 400, headers: { "Content-Type": "text/html" } });
      }
      return new Response(connectFormHtml(request.url), { headers: { "Content-Type": "text/html" } });
    }
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    const form = await request.formData();
    const apiKey = String(form.get("apiKey") ?? "").trim();
    const containerTag = String(form.get("containerTag") ?? "").trim();
    if (!apiKey || !CONTAINER_TAG_RE.test(containerTag)) {
      return new Response(connectFormHtml(request.url,
        "Enter an organization API key and a valid default container tag.", containerTag || "default"),
      { status: 400, headers: { "Content-Type": "text/html" } });
    }
    const result = await account.completeConnection(path[1], apiKey, containerTag);
    if (result.kind === "invalid_nonce") {
      return new Response(INVALID_LINK_HTML, { status: 400, headers: { "Content-Type": "text/html" } });
    }
    if (result.kind === "error") {
      return new Response(connectFormHtml(request.url, result.message, containerTag),
        { status: 400, headers: { "Content-Type": "text/html" } });
    }
    return new Response(SELF_CLOSING_HTML, { headers: { "Content-Type": "text/html" } });
  },
};

@validateRpc()
export class GatekeeperVendor extends WorkerEntrypoint<Env> implements GatekeeperVendorIface {
  async describe(): Promise<VendorDescription> {
    return {
      displayName: "Supermemory",
      url: "https://supermemory.ai",
      logo: { url: LOGO_URL },
      color: "#ede9fe",
      tagline: "Persistent memory and retrieval for every agent",
      description:
        "Give agents isolated persistent memory spaces, ingest source documents, and explicitly " +
        "grant organization management for scoped keys and synchronized connectors.",
    };
  }

  async connectAccount(callback: Fetcher<GatekeeperConnectCallback>): Promise<{ url: string }> {
    const id = this.ctx.exports.UserAccount.newUniqueId();
    const nonce = generateNonce();
    await this.ctx.exports.UserAccount.get(id).setCallback(callback, nonce);
    return { url: `${getBaseUrl(this.env)}/${id.toString()}/${nonce}` };
  }

  async getSupportedResources(): Promise<SupportedResource[]> { return SUPPORTED_RESOURCES; }
  async getTypeScriptTypes(): Promise<string> { return TYPES_CODE; }
}

export class UserAccount extends DurableObject<Env> {
  async setCallback(callback: Fetcher<GatekeeperConnectCallback>, nonce: string): Promise<void> {
    if (!this.ctx.storage.kv.get<StoredCredentials>("credentials")) {
      this.ctx.storage.setAlarm(Date.now() + 60 * 60 * 1000);
    }
    this.ctx.storage.kv.put("callback", callback);
    this.ctx.storage.kv.put<StoredNonce>("nonce", {
      value: nonce,
      expiresAt: Date.now() + NONCE_LIFETIME_MS,
    });
  }

  async prepareReconnect(nonce: string): Promise<void> {
    this.ctx.storage.kv.put("reconnecting", true);
    this.ctx.storage.kv.put<StoredNonce>("nonce", {
      value: nonce,
      expiresAt: Date.now() + NONCE_LIFETIME_MS,
    });
  }

  async verifyNonceWithoutConsuming(nonce: string): Promise<boolean> {
    const stored = this.ctx.storage.kv.get<StoredNonce>("nonce");
    return Boolean(stored && Date.now() < stored.expiresAt && constantTimeEqual(stored.value, nonce));
  }

  async completeConnection(nonce: string, apiKey: string, defaultContainerTag: string):
      Promise<CompleteConnectionResult> {
    if (!await this.verifyNonceWithoutConsuming(nonce)) return { kind: "invalid_nonce" };
    try {
      await new SupermemoryApi(async () => apiKey).validateOrganizationKey();
    } catch (error) {
      const message = error instanceof SupermemoryApiError && error.status === 401
        ? "Supermemory rejected this API key. Use an organization key from the Developer Platform."
        : error instanceof Error ? error.message : "Unable to validate this Supermemory API key.";
      return { kind: "error", message };
    }
    this.ctx.storage.kv.delete("nonce");
    this.ctx.storage.kv.put<StoredCredentials>("credentials", { apiKey, defaultContainerTag });
    const callback = this.ctx.storage.kv.get<Fetcher<GatekeeperConnectCallback>>("callback");
    if (!callback) {
      this.ctx.storage.kv.delete("credentials");
      return { kind: "error", message: "The Cloudflare OS connection expired. Please restart it." };
    }
    try {
      if (this.ctx.storage.kv.get<boolean>("reconnecting")) {
        this.ctx.storage.kv.delete("reconnecting");
        await callback.credentialsRestored();
      } else {
        await callback.complete(this.ctx.exports.SupermemoryUser({
          props: { userObjectId: this.ctx.id.toString() },
        }));
      }
    } catch (error) {
      this.ctx.storage.kv.delete("credentials");
      return { kind: "error", message: error instanceof Error ? error.message : String(error) };
    }
    this.ctx.storage.deleteAlarm();
    return { kind: "ok" };
  }

  getCredentials(): StoredCredentials {
    const credentials = this.ctx.storage.kv.get<StoredCredentials>("credentials");
    if (!credentials) throw new Error("Supermemory credentials are unavailable. Reconnect the account.");
    return credentials;
  }

  saveScopedKey(info: SupermemoryScopedKeyInfo): void {
    this.ctx.storage.kv.put(`scopedKey:${info.id}`, info);
  }

  listScopedKeys(): SupermemoryScopedKeyInfo[] {
    return [...this.ctx.storage.kv.list<SupermemoryScopedKeyInfo>({ prefix: "scopedKey:" })]
      .map(([, value]) => value)
      .toSorted((a, b) => a.name.localeCompare(b.name));
  }

  markScopedKeyRevoked(id: string): void {
    const key = this.ctx.storage.kv.get<SupermemoryScopedKeyInfo>(`scopedKey:${id}`);
    if (key) this.ctx.storage.kv.put(`scopedKey:${id}`, { ...key, revoked: true });
  }

  async alarm(): Promise<void> {
    if (!this.ctx.storage.kv.get<StoredCredentials>("credentials")) this.ctx.storage.deleteAll();
  }

  async revoke(): Promise<void> {
    this.ctx.storage.deleteAlarm();
    this.ctx.storage.deleteAll();
  }
}

type SupermemoryUserProps = { userObjectId: string };

@validateRpc()
export class SupermemoryUser extends WorkerEntrypoint<Env, SupermemoryUserProps>
    implements GatekeeperUser {
  #account() {
    return this.ctx.exports.UserAccount.get(
      this.ctx.exports.UserAccount.idFromString(this.ctx.props.userObjectId));
  }

  #api(): SupermemoryApi {
    return new SupermemoryApi(async () => (await this.#account().getCredentials()).apiKey);
  }

  async describe(): Promise<AccountDescription> {
    const credentials = await this.#account().getCredentials();
    return {
      displayName: `Supermemory (${credentials.defaultContainerTag})`,
      uniqueName: credentials.defaultContainerTag,
      avatar: { url: LOGO_URL },
      singleton: { tsType: "SupermemoryContainer" },
    };
  }

  async getAuthenticatedEmail(): Promise<string | null> { return null; }
  async getSupportedResources(): Promise<SupportedResource[]> { return SUPPORTED_RESOURCES; }

  async getSingletonGatekeeperClass(): Promise<DurableObjectClass<Gatekeeper<SupermemoryContainer>>> {
    const credentials = await this.#account().getCredentials();
    return this.ctx.exports.SupermemoryContainerGatekeeper({
      props: {
        userObjectId: this.ctx.props.userObjectId,
        containerTag: credentials.defaultContainerTag,
      },
    });
  }

  async startResourceConfigurator(resourceUrlPattern: string): Promise<ResourceConfiguratorFrame> {
    if (resourceUrlPattern === CONTAINER_RESOURCE.urlPattern) {
      return {
        iframeHtml: CONTAINER_CONFIGURATOR_HTML,
        ui: new RpcStub(new ContainerConfigurator(this.#api())),
      };
    }
    if (resourceUrlPattern === ORGANIZATION_RESOURCE.urlPattern) {
      return {
        iframeHtml: ORGANIZATION_CONFIGURATOR_HTML,
        ui: new RpcStub(new OrganizationConfigurator()),
      };
    }
    throw new Error(`Unsupported Supermemory resource type: ${resourceUrlPattern}`);
  }

  async getGatekeeperClassFor(url: string): Promise<{
    class: DurableObjectClass<Gatekeeper<any>>;
    resource: SupportedResource;
  }> {
    const parsed = new URL(url);
    if (parsed.hostname === "console.supermemory.ai" && parsed.pathname === "/") {
      return {
        class: this.ctx.exports.SupermemoryOrganizationGatekeeper({
          props: { userObjectId: this.ctx.props.userObjectId },
        }),
        resource: ORGANIZATION_RESOURCE,
      };
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parsed.hostname !== "api.supermemory.ai" || parts.length !== 3 ||
        parts[0] !== "v3" || parts[1] !== "container-tags") {
      throw new Error(`Unsupported Supermemory resource URL: ${url}`);
    }
    const containerTag = requireContainerTag(decodeURIComponent(parts[2]));
    return {
      class: this.ctx.exports.SupermemoryContainerGatekeeper({
        props: { userObjectId: this.ctx.props.userObjectId, containerTag },
      }),
      resource: CONTAINER_RESOURCE,
    };
  }

  async revoke(): Promise<void> { await this.#account().revoke(); }

  async reconnect(): Promise<{ url: string }> {
    const nonce = generateNonce();
    await this.#account().prepareReconnect(nonce);
    return { url: `${getBaseUrl(this.env)}/${this.ctx.props.userObjectId}/${nonce}` };
  }

  async ensureResources(_resourceUrlPatterns: string[]): Promise<{ url?: string }> { return {}; }

  @skipRpcValidation()
  async getVerifier(): Promise<Fetcher<GatekeeperUserVerifier>> {
    return this.ctx.exports.SupermemoryVerifier({});
  }
}

@validateRpc()
export class SupermemoryVerifier extends WorkerEntrypoint<Env> implements GatekeeperUserVerifier {
  verify(): void {}
}

@validateRpc()
class ContainerConfigurator extends RpcTarget implements SupermemoryContainerConfiguratorRpc {
  constructor(private readonly api: SupermemoryApi) { super(); }

  async listContainers(query: string) {
    const normalized = query.trim().toLowerCase();
    return (await this.api.listContainers())
      .filter(container => !normalized || `${container.name ?? ""} ${container.containerTag}`
        .toLowerCase().includes(normalized))
      .slice(0, 100)
      .map(container => ({
        value: container.containerTag,
        title: container.name ?? container.containerTag,
        subtitle: container.name ? container.containerTag : undefined,
      }));
  }
}

@validateRpc()
class OrganizationConfigurator extends RpcTarget implements SupermemoryOrganizationConfiguratorRpc {
  async getLabel(): Promise<string> { return "Supermemory organization"; }
}

type ContainerGatekeeperProps = { userObjectId: string; containerTag: string };
type OrganizationGatekeeperProps = { userObjectId: string };

abstract class SupermemoryGatekeeperBase<Props extends { userObjectId: string }>
    extends DurableObject<Env, Props> {
  protected account(userObjectId: string) {
    return this.ctx.exports.UserAccount.get(this.ctx.exports.UserAccount.idFromString(userObjectId));
  }

  protected api(userObjectId: string): SupermemoryApi {
    const account = this.account(userObjectId);
    return new SupermemoryApi(async () => (await account.getCredentials()).apiKey);
  }

  protected store(): SupermemoryStore {
    return new SupermemoryStore(this.ctx.storage.kv, this.api(this.ctx.props.userObjectId),
      this.account(this.ctx.props.userObjectId));
  }

  async getTypeScriptTypes(): Promise<string> { return TYPES_CODE; }
  async getAutoApprovableActions(): Promise<never[]> { return []; }
  async applyAction(action: number): Promise<void> {
    await applySupermemoryAction(this.store(), action);
  }
  async rejectAction(action: number): Promise<void | { restart?: boolean }> {
    return rejectSupermemoryAction(this.store(), action);
  }
  async revertAction(action: number):
      Promise<void | { message?: string; canRetry?: boolean; restart?: boolean }> {
    return await revertSupermemoryAction(this.store(), action);
  }
  async addObserver(): Promise<void> {
    throw new Error("Supermemory data is private to the connection owner.");
  }
  async removeObserver(_id: string): Promise<void> {}
}

@validateRpc()
export class SupermemoryContainerGatekeeper extends SupermemoryGatekeeperBase<ContainerGatekeeperProps>
    implements Gatekeeper<SupermemoryContainer> {
  async describe(): Promise<ResourceDescription> {
    let title = this.ctx.props.containerTag;
    let snippet = "Isolated Supermemory space";
    try {
      const info = await this.api(this.ctx.props.userObjectId).getContainer(this.ctx.props.containerTag);
      title = info.name ?? info.containerTag;
      snippet = info.entityContext ?? snippet;
    } catch (error) {
      if (!(error instanceof SupermemoryApiError) || error.status !== 404) throw error;
    }
    return {
      url: `https://api.supermemory.ai/v3/container-tags/${encodeURIComponent(this.ctx.props.containerTag)}`,
      title,
      snippet,
      suggestedBindingName: "SUPERMEMORY",
      tsType: "SupermemoryContainer",
    };
  }

  async startSession(queue: RpcStub<ApprovalQueue>): Promise<SupermemoryContainer> {
    return new ContainerSession(this.store(), this.ctx.props.containerTag, queue.dup());
  }
}

@validateRpc()
export class SupermemoryOrganizationGatekeeper
    extends SupermemoryGatekeeperBase<OrganizationGatekeeperProps>
    implements Gatekeeper<SupermemoryOrganization> {
  async describe(): Promise<ResourceDescription> {
    return {
      url: "https://console.supermemory.ai/",
      title: "Supermemory organization",
      snippet: "Administrative access to spaces, scoped keys, and connectors",
      suggestedBindingName: "SUPERMEMORY_ADMIN",
      tsType: "SupermemoryOrganization",
    };
  }

  async startSession(queue: RpcStub<ApprovalQueue>): Promise<SupermemoryOrganization> {
    return new OrganizationSession(this.store(), this.account(this.ctx.props.userObjectId), queue.dup());
  }
}

abstract class SessionBase extends RpcTarget {
  constructor(protected readonly store: SupermemoryStore, protected readonly queue: RpcStub<ApprovalQueue>) {
    super();
  }
  protected get api(): SupermemoryApi { return this.store.api; }
  protected async observe(title: string, description: string): Promise<void> {
    await this.queue.authorizeObservation({ title, description });
  }
  protected async stage(action: SupermemoryAction): Promise<number> {
    return await stageSupermemoryAction(this.store, this.queue, action);
  }
  [Symbol.dispose](): void { this.queue[Symbol.dispose](); }
}

@validateRpc()
class ContainerSession extends SessionBase implements SupermemoryContainer {
  constructor(store: SupermemoryStore, private readonly containerTag: string, queue: RpcStub<ApprovalQueue>) {
    super(store, queue);
  }

  async #baseInfo(): Promise<SupermemoryContainerInfo> {
    try {
      return await this.store.cached(`container:${this.containerTag}`, 30_000,
        () => this.api.getContainer(this.containerTag));
    } catch (error) {
      const impliesContainer = this.store.pendingActions().some(record =>
        "containerTag" in record.action && record.action.containerTag === this.containerTag);
      if (!(error instanceof SupermemoryApiError) || error.status !== 404 || !impliesContainer) throw error;
      return {
        containerTag: this.containerTag,
        name: null,
        entityContext: null,
        profileBuckets: [],
        createdAt: null,
        updatedAt: null,
      };
    }
  }

  async getInfo(): Promise<SupermemoryContainerInfo> {
    let info = await this.#baseInfo();
    for (const { action } of this.store.pendingActions()) {
      if (action.type === "updateContainer" && action.containerTag === this.containerTag) {
        info = { ...info, ...action.update };
      }
    }
    await this.observe("Read Supermemory space settings",
      `Read settings for the isolated memory space \`${this.containerTag}\`.`);
    return info;
  }
  async updateInfo(update: SupermemoryContainerUpdate): Promise<SupermemoryContainerInfo> {
    await this.stage({ type: "updateContainer", containerTag: this.containerTag, update });
    return await this.getInfo();
  }
  async getProfile(): Promise<SupermemoryProfile> {
    const result = await this.store.cached(`profile:${this.containerTag}`, 20_000,
      () => this.api.getProfile(this.containerTag));
    const profile = overlayProfile(result.profile, this.store, this.containerTag);
    await this.observe("Read Supermemory profile",
      `Read the maintained profile for \`${this.containerTag}\`.`);
    return profile;
  }
  async recall(query: string, options?: SupermemorySearchOptions): Promise<SupermemoryRecall> {
    const key = stableCacheKey("recall", this.containerTag, query, options);
    const result = await this.store.cached(key, 20_000,
      () => this.api.getProfile(this.containerTag, query, options));
    const recall = {
      profile: overlayProfile(result.profile, this.store, this.containerTag),
      results: overlaySearch(result.results, this.store, this.containerTag, query),
    };
    await this.observe("Recall from Supermemory",
      `Read the profile and ${recall.results.length} relevant result(s) from \`${this.containerTag}\`.`);
    return recall;
  }
  async search(query: string, options?: SupermemorySearchOptions): Promise<SupermemorySearchResult[]> {
    const key = stableCacheKey("search", this.containerTag, query, options);
    const base = await this.store.cached(key, 20_000,
      () => this.api.search(this.containerTag, query, options));
    const results = overlaySearch(base, this.store, this.containerTag, query);
    await this.observe("Search Supermemory",
      `Search \`${this.containerTag}\` for ${JSON.stringify(query)} and return ${results.length} result(s).`);
    return results;
  }
  async listMemories(options?: SupermemoryListOptions): Promise<SupermemoryMemoryPage> {
    const base = await this.store.cached(stableCacheKey("memories", this.containerTag, options), 20_000,
      () => this.api.listMemories(this.containerTag, options));
    const result = overlayMemoryPage(base, this.store, this.containerTag);
    await this.observe("List Supermemory memories",
      `Read ${result.memories.length} memory entries from \`${this.containerTag}\`.`);
    return result;
  }
  async remember(input: SupermemoryRememberInput): Promise<SupermemoryMemory> {
    const provisionalId = this.store.nextProvisionalId("memory");
    await this.stage({ type: "remember", containerTag: this.containerTag, input, provisionalId });
    return new MemorySession(this.store, this.containerTag, provisionalId, this.queue.dup());
  }
  async memory(id: string): Promise<SupermemoryMemory> {
    const capability = new MemorySession(this.store, this.containerTag, id, this.queue.dup());
    await capability.getInfo();
    return capability;
  }
  async listDocuments(options?: SupermemoryListOptions): Promise<SupermemoryDocumentPage> {
    const base = await this.store.cached(stableCacheKey("documents", this.containerTag, options), 20_000,
      () => this.api.listDocuments(this.containerTag, options));
    const result = overlayDocumentPage(base, this.store, this.containerTag);
    await this.observe("List Supermemory documents",
      `Read ${result.documents.length} document entries from \`${this.containerTag}\`.`);
    return result;
  }
  async addDocument(input: SupermemoryDocumentInput): Promise<SupermemoryDocument> {
    const provisionalId = this.store.nextProvisionalId("document");
    await this.stage({ type: "addDocument", containerTag: this.containerTag, input, provisionalId });
    return new DocumentSession(this.store, this.containerTag, provisionalId, this.queue.dup());
  }
  async document(id: string): Promise<SupermemoryDocument> {
    const capability = new DocumentSession(this.store, this.containerTag, id, this.queue.dup());
    await capability.getInfo();
    return capability;
  }
}

@validateRpc()
class MemorySession extends SessionBase implements SupermemoryMemory {
  constructor(store: SupermemoryStore, private readonly containerTag: string, private readonly id: string,
              queue: RpcStub<ApprovalQueue>) { super(store, queue); }
  async getInfo(): Promise<SupermemoryMemoryInfo> {
    const resolved = this.store.resolveId(this.id);
    let info: SupermemoryMemoryInfo;
    if (resolved.startsWith("~")) {
      const record = this.store.actionForProvisional(resolved);
      if (!record || record.action.type !== "remember") {
        throw new Error(`Unknown provisional Supermemory memory: ${this.id}`);
      }
      info = simulatedMemory(resolved, record.action.input, record.submittedAt);
    } else {
      info = await this.store.cached(`memory:${this.containerTag}:${resolved}`, 20_000,
        () => this.api.getMemory(this.containerTag, resolved));
    }
    info = overlayMemory(info, this.store, this.containerTag, this.id);
    await this.observe("Read Supermemory memory",
      `Read memory \`${this.id}\` from \`${this.containerTag}\`.`);
    return info;
  }
  async update(input: SupermemoryMemoryUpdate): Promise<SupermemoryMemoryInfo> {
    await this.stage({ type: "updateMemory", containerTag: this.containerTag, memoryId: this.id, input });
    return await this.getInfo();
  }
  async forget(reason?: string): Promise<void> {
    await this.stage({ type: "forgetMemory", containerTag: this.containerTag, memoryId: this.id, reason });
  }
}

@validateRpc()
class DocumentSession extends SessionBase implements SupermemoryDocument {
  constructor(store: SupermemoryStore, private readonly containerTag: string, private readonly id: string,
              queue: RpcStub<ApprovalQueue>) { super(store, queue); }
  async getInfo(): Promise<SupermemoryDocumentInfo> {
    const resolved = this.store.resolveId(this.id);
    let info: SupermemoryDocumentInfo;
    if (resolved.startsWith("~")) {
      const record = this.store.actionForProvisional(resolved);
      if (!record || record.action.type !== "addDocument") {
        throw new Error(`Unknown provisional Supermemory document: ${this.id}`);
      }
      info = simulatedDocument(resolved, record.action.input, record.submittedAt);
    } else {
      info = await this.store.cached(`document:${this.containerTag}:${resolved}`, 20_000,
        () => this.api.getDocument(this.containerTag, resolved));
    }
    info = overlayDocument(info, this.store, this.containerTag, this.id);
    await this.observe("Read Supermemory document",
      `Read document \`${this.id}\` from \`${this.containerTag}\`.`);
    return info;
  }
  async update(input: SupermemoryDocumentUpdate): Promise<SupermemoryDocumentInfo> {
    await this.stage({ type: "updateDocument", containerTag: this.containerTag, documentId: this.id, input });
    return await this.getInfo();
  }
  async delete(): Promise<void> {
    await this.stage({ type: "deleteDocument", containerTag: this.containerTag, documentId: this.id });
  }
}

@validateRpc()
class OrganizationSession extends SessionBase implements SupermemoryOrganization {
  constructor(store: SupermemoryStore, private readonly account: DurableObjectStub<UserAccount>,
              queue: RpcStub<ApprovalQueue>) { super(store, queue); }
  async listContainers(): Promise<SupermemoryContainerInfo[]> {
    let containers = await this.store.cached("organization:containers", 30_000,
      () => this.api.listContainers());
    const byTag = new Map(containers.map(container => [container.containerTag, container]));
    for (const record of this.store.pendingActions()) {
      const action = record.action;
      if ("containerTag" in action && typeof action.containerTag === "string" &&
          !byTag.has(action.containerTag)) {
        byTag.set(action.containerTag, {
          containerTag: action.containerTag,
          name: null,
          entityContext: null,
          profileBuckets: [],
          createdAt: null,
          updatedAt: null,
        });
      }
      if (action.type === "updateContainer") {
        const current = byTag.get(action.containerTag);
        if (current) byTag.set(action.containerTag, { ...current, ...action.update });
      }
    }
    containers = [...byTag.values()];
    await this.observe("List Supermemory spaces",
      `Read ${containers.length} memory spaces from the connected organization.`);
    return containers;
  }
  async container(containerTag: string): Promise<SupermemoryContainer> {
    return new ContainerSession(this.store, requireContainerTag(containerTag), this.queue.dup());
  }
  async listConnections(containerTag?: string): Promise<SupermemoryConnectionInfo[]> {
    const validated = containerTag && requireContainerTag(containerTag);
    let connections = await this.store.cached(stableCacheKey("connections", validated), 20_000,
      () => this.api.listConnections(validated));
    connections = overlayConnections(connections, this.store, validated);
    await this.observe("List Supermemory source connectors",
      `Read ${connections.length} source connector(s)${validated ? ` for \`${validated}\`` : ""}.`);
    return connections;
  }
  async beginConnection(input: SupermemoryConnectionInput): Promise<SupermemoryConnectionSetup> {
    const normalized = { ...input, containerTags: input.containerTags.map(requireContainerTag) };
    const provisionalId = this.store.nextProvisionalId("connection");
    await this.stage({ type: "beginConnection", input: normalized, provisionalId });
    return {
      id: provisionalId,
      authorizationUrl: null,
      expiresIn: null,
    };
  }
  async connection(id: string): Promise<SupermemoryConnection> {
    const capability = new ConnectionSession(this.store, id, this.queue.dup());
    await capability.getInfo();
    return capability;
  }
  async issueScopedKey(input: SupermemoryScopedKeyInput): Promise<SupermemoryScopedKeyIssuance> {
    const normalized = { ...input, containerTag: requireContainerTag(input.containerTag) };
    const provisionalId = this.store.nextProvisionalId("key");
    await this.stage({ type: "issueScopedKey", input: normalized, provisionalId });
    return new ScopedKeyIssuanceSession(this.store, provisionalId, this.queue.dup());
  }
  async scopedKeyIssuance(id: string): Promise<SupermemoryScopedKeyIssuance> {
    let provisionalId = id;
    if (!id.startsWith("~")) {
      const record = this.store.actions().find(candidate =>
        candidate.action.type === "issueScopedKey" && candidate.result?.realId === id);
      if (!record || record.action.type !== "issueScopedKey") {
        throw new Error(`No scoped-key issuance is retained for ${id}.`);
      }
      provisionalId = record.action.provisionalId;
    }
    const capability = new ScopedKeyIssuanceSession(this.store, provisionalId, this.queue.dup());
    await capability.getInfo();
    return capability;
  }
  async listIssuedScopedKeys(): Promise<SupermemoryScopedKeyInfo[]> {
    let keys: SupermemoryScopedKeyInfo[] = [...await this.account.listScopedKeys()];
    const byId = new Map(keys.map(key => [key.id, key]));
    for (const record of this.store.pendingActions()) {
      const action = record.action;
      if (action.type === "issueScopedKey") {
        byId.set(action.provisionalId, simulatedScopedKey(action.provisionalId, action.input));
      } else if (action.type === "revokeScopedKey") {
        const target = this.store.resolveId(action.keyId);
        const current = byId.get(target) ?? byId.get(action.keyId);
        if (current) byId.set(current.id, { ...current, revoked: true });
      }
    }
    keys = [...byId.values()];
    await this.observe("List Supermemory scoped keys",
      `Read metadata for ${keys.length} scoped key(s) issued through this gatekeeper.`);
    return keys;
  }
  async revokeScopedKey(id: string): Promise<void> {
    await this.stage({ type: "revokeScopedKey", keyId: id });
  }
  async getSettings(): Promise<SupermemoryOrganizationSettings> {
    let settings = await this.store.cached("organization:settings", 30_000,
      () => this.api.getSettings());
    for (const { action } of this.store.pendingActions()) {
      if (action.type === "updateSettings") settings = { ...settings, ...action.update };
    }
    await this.observe("Read Supermemory organization settings",
      "Read supported settings for the connected Supermemory organization.");
    return settings;
  }
  async updateSettings(update: SupermemoryOrganizationSettingsUpdate): Promise<SupermemoryOrganizationSettings> {
    await this.stage({ type: "updateSettings", update });
    return await this.getSettings();
  }
}

@validateRpc()
class ConnectionSession extends SessionBase implements SupermemoryConnection {
  constructor(store: SupermemoryStore, private readonly id: string, queue: RpcStub<ApprovalQueue>) {
    super(store, queue);
  }
  async getInfo(): Promise<SupermemoryConnectionInfo> {
    const resolved = this.store.resolveId(this.id);
    let info: SupermemoryConnectionInfo;
    const creation = this.store.actionForProvisional(this.id);
    if (resolved.startsWith("~")) {
      if (!creation || creation.action.type !== "beginConnection") {
        throw new Error(`Unknown provisional Supermemory connector: ${this.id}`);
      }
      info = simulatedConnection(this.id, creation.action.input, creation.submittedAt);
    } else {
      info = await this.store.cached(`connection:${resolved}`, 20_000,
        () => this.api.getConnection(resolved));
      if (creation?.result) info = { ...info, authorizationUrl: creation.result.authorizationUrl };
    }
    for (const { action } of this.store.pendingActions()) {
      if (action.type === "disconnectConnection" &&
          this.store.resolveId(action.connectionId) === resolved) {
        info = { ...info, lastSyncStatus: "disconnect pending" };
      } else if (action.type === "syncConnection" &&
          this.store.resolveId(action.connectionId) === resolved) {
        info = { ...info, lastSyncStatus: "sync pending" };
      }
    }
    await this.observe("Read Supermemory connector",
      `Read source connector \`${this.id}\`.`);
    return info;
  }
  async listResources(options: SupermemoryListOptions = {}): Promise<SupermemoryConnectionResourcePage> {
    const resolved = this.store.resolveId(this.id);
    if (resolved.startsWith("~")) {
      await this.observe("List Supermemory connector resources",
        `Read selectable resources for pending connector \`${this.id}\`.`);
      return { resources: [], total: 0 };
    }
    const page = options.page ?? 1;
    const limit = options.limit ?? 50;
    const value = await this.store.cached(stableCacheKey("connection-resources", resolved, page, limit),
      20_000, () => this.api.request<Record<string, any>>(
        `/v3/connections/${encodeURIComponent(resolved)}/resources?page=${page}&per_page=${limit}`));
    const result = {
      resources: Array.isArray(value.resources) ? value.resources.map((item: Record<string, any>) => ({
        id: item.id,
        name: String(item.full_name ?? item.name ?? item.id),
        ...(item.default_branch ? { defaultBranch: String(item.default_branch) } : {}),
      })) : [],
      total: Number(value.total_count ?? value.resources?.length ?? 0),
    };
    await this.observe("List Supermemory connector resources",
      `Read ${result.resources.length} selectable resource(s) for connector \`${this.id}\`.`);
    return result;
  }
  async configureResources(resources: SupermemoryConnectionResource[]): Promise<void> {
    await this.stage({ type: "configureConnection", connectionId: this.id, resources });
  }
  async sync(): Promise<void> {
    await this.stage({ type: "syncConnection", connectionId: this.id });
  }
  async disconnect(options: { deleteImportedDocuments?: boolean } = {}): Promise<void> {
    await this.stage({
      type: "disconnectConnection",
      connectionId: this.id,
      deleteImportedDocuments: options.deleteImportedDocuments ?? false,
    });
  }
}

@validateRpc()
class ScopedKeyIssuanceSession extends SessionBase implements SupermemoryScopedKeyIssuance {
  constructor(store: SupermemoryStore, private readonly provisionalId: string,
              queue: RpcStub<ApprovalQueue>) { super(store, queue); }

  async getInfo(): Promise<SupermemoryScopedKeyInfo> {
    const record = this.store.actionForProvisional(this.provisionalId);
    if (!record || record.action.type !== "issueScopedKey") {
      throw new Error(`Unknown Supermemory key issuance: ${this.provisionalId}`);
    }
    const info = record.result?.scopedKey ??
      simulatedScopedKey(this.provisionalId, record.action.input);
    await this.observe("Read Supermemory scoped-key issuance",
      `Read issuance metadata for key \`${this.provisionalId}\`.`);
    return info;
  }

  async revealSecret(): Promise<SupermemoryScopedKeySecret> {
    const record = this.store.actionForProvisional(this.provisionalId);
    if (!record?.result?.scopedKeySecret || !record.result.scopedKey) {
      throw new Error("The scoped key is not available yet, was already revealed, or issuance failed.");
    }
    await this.observe("Reveal a newly issued Supermemory scoped key",
      `Reveal the bearer token for scoped-key issuance \`${this.provisionalId}\`.`);
    const result = takeScopedKeySecret(this.store, this.provisionalId);
    if (!result) throw new Error("The scoped key secret is no longer available.");
    return { ...result.info, key: result.key };
  }
}

function stableCacheKey(...parts: unknown[]): string {
  const value = JSON.stringify(parts);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `query:${(hash >>> 0).toString(16)}`;
}

function simulatedMemory(
  id: string,
  input: SupermemoryRememberInput,
  submittedAt: number,
): SupermemoryMemoryInfo {
  const timestamp = new Date(submittedAt).toISOString();
  return {
    id,
    content: input.content,
    isStatic: input.isStatic ?? false,
    metadata: input.metadata ?? null,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    isForgotten: false,
  };
}

function sameTarget(store: SupermemoryStore, left: string, right: string): boolean {
  return left === right || store.resolveId(left) === store.resolveId(right);
}

function overlayMemory(
  original: SupermemoryMemoryInfo,
  store: SupermemoryStore,
  containerTag: string,
  requestedId: string,
): SupermemoryMemoryInfo {
  let memory = original;
  for (const record of store.pendingActions()) {
    const action = record.action;
    if (action.type === "updateMemory" && action.containerTag === containerTag &&
        sameTarget(store, action.memoryId, requestedId)) {
      memory = {
        ...memory,
        content: action.input.content,
        metadata: action.input.metadata ?? memory.metadata,
        version: memory.version + 1,
        updatedAt: new Date(record.submittedAt).toISOString(),
      };
    } else if (action.type === "forgetMemory" && action.containerTag === containerTag &&
        sameTarget(store, action.memoryId, requestedId)) {
      memory = { ...memory, isForgotten: true, updatedAt: new Date(record.submittedAt).toISOString() };
    }
  }
  return memory;
}

function overlayMemoryPage(
  base: SupermemoryMemoryPage,
  store: SupermemoryStore,
  containerTag: string,
): SupermemoryMemoryPage {
  const byId = new Map(base.memories.map(memory => [memory.id, memory]));
  for (const record of store.pendingActions()) {
    if (record.action.type === "remember" && record.action.containerTag === containerTag) {
      byId.set(record.action.provisionalId,
        simulatedMemory(record.action.provisionalId, record.action.input, record.submittedAt));
    }
  }
  const memories = [...byId.values()].map(memory =>
    overlayMemory(memory, store, containerTag, memory.id));
  return {
    ...base,
    memories,
    totalItems: Math.max(base.totalItems, memories.length),
  };
}

function overlayProfile(
  base: SupermemoryProfile,
  store: SupermemoryStore,
  containerTag: string,
): SupermemoryProfile {
  const profile = {
    static: [...base.static],
    dynamic: [...base.dynamic],
    buckets: Object.fromEntries(Object.entries(base.buckets).map(([key, values]) => [key, [...values]])),
  };
  for (const { action } of store.pendingActions()) {
    if (action.type !== "remember" || action.containerTag !== containerTag) continue;
    const target = action.input.isStatic ? profile.static : profile.dynamic;
    if (!target.includes(action.input.content)) target.push(action.input.content);
  }
  return profile;
}

function overlaySearch(
  base: SupermemorySearchResult[],
  store: SupermemoryStore,
  containerTag: string,
  query: string,
): SupermemorySearchResult[] {
  const byId = new Map(base.map(result => [result.id, result]));
  for (const record of store.pendingActions()) {
    const action = record.action;
    if (action.type === "remember" && action.containerTag === containerTag &&
        lexicalMatch(action.input.content, query)) {
      byId.set(action.provisionalId, {
        id: action.provisionalId,
        kind: "memory",
        content: action.input.content,
        similarity: 1,
        metadata: action.input.metadata ?? null,
        updatedAt: new Date(record.submittedAt).toISOString(),
        version: 1,
      });
    } else if (action.type === "updateMemory" && action.containerTag === containerTag) {
      const target = [...byId.keys()].find(id => sameTarget(store, id, action.memoryId));
      if (target) {
        const previous = byId.get(target)!;
        if (lexicalMatch(action.input.content, query)) {
          byId.set(target, {
            ...previous,
            content: action.input.content,
            metadata: action.input.metadata ?? previous.metadata,
            updatedAt: new Date(record.submittedAt).toISOString(),
            version: (previous.version ?? 1) + 1,
          });
        } else {
          byId.delete(target);
        }
      }
    } else if (action.type === "forgetMemory" && action.containerTag === containerTag) {
      const target = [...byId.keys()].find(id => sameTarget(store, id, action.memoryId));
      if (target) byId.delete(target);
    }
  }
  return [...byId.values()];
}

function lexicalMatch(content: string, query: string): boolean {
  const terms = query.toLowerCase().split(/\W+/).filter(term => term.length > 2);
  if (terms.length === 0) return true;
  const normalized = content.toLowerCase();
  return terms.some(term => normalized.includes(term));
}

function simulatedDocument(
  id: string,
  input: SupermemoryDocumentInput,
  submittedAt: number,
): SupermemoryDocumentInfo {
  const timestamp = new Date(submittedAt).toISOString();
  let title: string | null = null;
  try {
    const url = new URL(input.content);
    title = url.hostname;
  } catch {}
  return {
    id,
    title,
    status: "queued",
    type: input.taskType ?? "memory",
    summary: null,
    metadata: input.metadata ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function overlayDocument(
  original: SupermemoryDocumentInfo,
  store: SupermemoryStore,
  containerTag: string,
  requestedId: string,
): SupermemoryDocumentInfo {
  let document = original;
  for (const record of store.pendingActions()) {
    const action = record.action;
    if (action.type === "updateDocument" && action.containerTag === containerTag &&
        sameTarget(store, action.documentId, requestedId)) {
      document = {
        ...document,
        metadata: action.input.metadata ?? document.metadata,
        type: action.input.taskType ?? document.type,
        status: "queued",
        updatedAt: new Date(record.submittedAt).toISOString(),
      };
    } else if (action.type === "deleteDocument" && action.containerTag === containerTag &&
        sameTarget(store, action.documentId, requestedId)) {
      document = { ...document, status: "delete pending" };
    }
  }
  return document;
}

function overlayDocumentPage(
  base: SupermemoryDocumentPage,
  store: SupermemoryStore,
  containerTag: string,
): SupermemoryDocumentPage {
  const byId = new Map(base.documents.map(document => [document.id, document]));
  for (const record of store.pendingActions()) {
    const action = record.action;
    if (action.type === "addDocument" && action.containerTag === containerTag) {
      byId.set(action.provisionalId,
        simulatedDocument(action.provisionalId, action.input, record.submittedAt));
    } else if (action.type === "deleteDocument" && action.containerTag === containerTag) {
      const target = [...byId.keys()].find(id => sameTarget(store, id, action.documentId));
      if (target) byId.delete(target);
    }
  }
  const documents = [...byId.values()].map(document =>
    overlayDocument(document, store, containerTag, document.id));
  return { ...base, documents, totalItems: Math.max(base.totalItems, documents.length) };
}

function simulatedConnection(
  id: string,
  input: SupermemoryConnectionInput,
  submittedAt: number,
): SupermemoryConnectionInfo {
  return {
    id,
    provider: input.provider,
    email: null,
    containerTags: input.containerTags,
    documentLimit: input.documentLimit ?? null,
    createdAt: new Date(submittedAt).toISOString(),
    lastSyncStatus: "creation pending",
    authorizationUrl: null,
  };
}

function overlayConnections(
  base: SupermemoryConnectionInfo[],
  store: SupermemoryStore,
  containerTag?: string,
): SupermemoryConnectionInfo[] {
  const byId = new Map(base.map(connection => [connection.id, connection]));
  for (const record of store.pendingActions()) {
    const action = record.action;
    if (action.type === "beginConnection" &&
        (!containerTag || action.input.containerTags.includes(containerTag))) {
      byId.set(action.provisionalId,
        simulatedConnection(action.provisionalId, action.input, record.submittedAt));
    } else if (action.type === "disconnectConnection") {
      const target = [...byId.keys()].find(id => sameTarget(store, id, action.connectionId));
      if (target) byId.delete(target);
    } else if (action.type === "syncConnection") {
      const target = [...byId.keys()].find(id => sameTarget(store, id, action.connectionId));
      if (target) byId.set(target, { ...byId.get(target)!, lastSyncStatus: "sync pending" });
    }
  }
  return [...byId.values()];
}

function simulatedScopedKey(id: string, input: SupermemoryScopedKeyInput): SupermemoryScopedKeyInfo {
  return {
    id,
    name: input.name ?? `scoped_${input.containerTag}`,
    containerTag: input.containerTag,
    expiresAt: input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString()
      : null,
    revoked: false,
  };
}
