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
  SupermemoryScopedKeySecret,
  SupermemorySearchOptions,
  SupermemorySearchResult,
} from "./types";
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

abstract class SupermemoryGatekeeperBase<Props> extends DurableObject<Env, Props> {
  protected account(userObjectId: string) {
    return this.ctx.exports.UserAccount.get(this.ctx.exports.UserAccount.idFromString(userObjectId));
  }

  protected api(userObjectId: string): SupermemoryApi {
    const account = this.account(userObjectId);
    return new SupermemoryApi(async () => (await account.getCredentials()).apiKey);
  }

  async getTypeScriptTypes(): Promise<string> { return TYPES_CODE; }
  async getAutoApprovableActions(): Promise<never[]> { return []; }
  async applyAction(action: number): Promise<void> { throw new Error(`Unknown Supermemory action: ${action}`); }
  async rejectAction(_action: number): Promise<void> {}
  async revertAction(_action: number): Promise<{ message: string }> {
    return { message: "This phase-one Supermemory capability has no reversible queued actions." };
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
    return new ContainerSession(this.api(this.ctx.props.userObjectId), this.ctx.props.containerTag, queue.dup());
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
    const account = this.account(this.ctx.props.userObjectId);
    return new OrganizationSession(this.api(this.ctx.props.userObjectId), account, queue.dup());
  }
}

abstract class SessionBase extends RpcTarget {
  constructor(protected readonly api: SupermemoryApi, protected readonly queue: RpcStub<ApprovalQueue>) {
    super();
  }
  [Symbol.dispose](): void { this.queue[Symbol.dispose](); }
}

@validateRpc()
class ContainerSession extends SessionBase implements SupermemoryContainer {
  constructor(api: SupermemoryApi, private readonly containerTag: string, queue: RpcStub<ApprovalQueue>) {
    super(api, queue);
  }

  async getInfo(): Promise<SupermemoryContainerInfo> { return await this.api.getContainer(this.containerTag); }
  async updateInfo(update: SupermemoryContainerUpdate): Promise<SupermemoryContainerInfo> {
    return await this.api.updateContainer(this.containerTag, update);
  }
  async getProfile(): Promise<SupermemoryProfile> {
    return (await this.api.getProfile(this.containerTag)).profile;
  }
  async recall(query: string, options?: SupermemorySearchOptions): Promise<SupermemoryRecall> {
    return await this.api.getProfile(this.containerTag, query, options);
  }
  async search(query: string, options?: SupermemorySearchOptions): Promise<SupermemorySearchResult[]> {
    return await this.api.search(this.containerTag, query, options);
  }
  async listMemories(options?: SupermemoryListOptions): Promise<SupermemoryMemoryPage> {
    return await this.api.listMemories(this.containerTag, options);
  }
  async remember(input: SupermemoryRememberInput): Promise<SupermemoryMemory> {
    const id = await this.api.remember(this.containerTag, input);
    return new MemorySession(this.api, this.containerTag, id, this.queue.dup());
  }
  async memory(id: string): Promise<SupermemoryMemory> {
    await this.api.getMemory(this.containerTag, id);
    return new MemorySession(this.api, this.containerTag, id, this.queue.dup());
  }
  async listDocuments(options?: SupermemoryListOptions): Promise<SupermemoryDocumentPage> {
    return await this.api.listDocuments(this.containerTag, options);
  }
  async addDocument(input: SupermemoryDocumentInput): Promise<SupermemoryDocument> {
    const id = await this.api.addDocument(this.containerTag, input as unknown as Record<string, unknown>);
    return new DocumentSession(this.api, this.containerTag, id, this.queue.dup());
  }
  async document(id: string): Promise<SupermemoryDocument> {
    await this.api.getDocument(this.containerTag, id);
    return new DocumentSession(this.api, this.containerTag, id, this.queue.dup());
  }
}

@validateRpc()
class MemorySession extends SessionBase implements SupermemoryMemory {
  constructor(api: SupermemoryApi, private readonly containerTag: string, private readonly id: string,
              queue: RpcStub<ApprovalQueue>) { super(api, queue); }
  async getInfo(): Promise<SupermemoryMemoryInfo> { return await this.api.getMemory(this.containerTag, this.id); }
  async update(input: SupermemoryMemoryUpdate): Promise<SupermemoryMemoryInfo> {
    return await this.api.updateMemory(this.containerTag, this.id, input as unknown as Record<string, unknown>);
  }
  async forget(reason?: string): Promise<void> { await this.api.forgetMemory(this.containerTag, this.id, reason); }
}

@validateRpc()
class DocumentSession extends SessionBase implements SupermemoryDocument {
  constructor(api: SupermemoryApi, private readonly containerTag: string, private readonly id: string,
              queue: RpcStub<ApprovalQueue>) { super(api, queue); }
  async getInfo(): Promise<SupermemoryDocumentInfo> { return await this.api.getDocument(this.containerTag, this.id); }
  async update(input: SupermemoryDocumentUpdate): Promise<SupermemoryDocumentInfo> {
    return await this.api.updateDocument(this.containerTag, this.id, input);
  }
  async delete(): Promise<void> { await this.api.deleteDocument(this.containerTag, this.id); }
}

@validateRpc()
class OrganizationSession extends SessionBase implements SupermemoryOrganization {
  constructor(api: SupermemoryApi, private readonly account: DurableObjectStub<UserAccount>,
              queue: RpcStub<ApprovalQueue>) { super(api, queue); }
  async listContainers(): Promise<SupermemoryContainerInfo[]> { return await this.api.listContainers(); }
  async container(containerTag: string): Promise<SupermemoryContainer> {
    return new ContainerSession(this.api, requireContainerTag(containerTag), this.queue.dup());
  }
  async listConnections(containerTag?: string): Promise<SupermemoryConnectionInfo[]> {
    return await this.api.listConnections(containerTag && requireContainerTag(containerTag));
  }
  async beginConnection(input: SupermemoryConnectionInput): Promise<SupermemoryConnectionSetup> {
    const tags = input.containerTags.map(requireContainerTag);
    const metadata = { ...input.metadata, ...(input.startUrl ? { startUrl: input.startUrl } : {}) };
    const value = await this.api.request<Record<string, any>>(
      `/v3/connections/${encodeURIComponent(input.provider)}`,
      { method: "POST", body: JSON.stringify({
        containerTags: tags,
        ...(input.documentLimit === undefined ? {} : { documentLimit: input.documentLimit }),
        ...(Object.keys(metadata).length ? { metadata } : {}),
        redirectUrl: "https://console.supermemory.ai/",
      }) },
    );
    return {
      id: String(value.id),
      authorizationUrl: typeof value.authLink === "string" ? value.authLink : null,
      expiresIn: typeof value.expiresIn === "string" ? value.expiresIn : null,
    };
  }
  async connection(id: string): Promise<SupermemoryConnection> {
    const info = await this.api.getConnection(id);
    return new ConnectionSession(this.api, info.id, this.queue.dup());
  }
  async issueScopedKey(input: SupermemoryScopedKeyInput): Promise<SupermemoryScopedKeySecret> {
    const value = await this.api.request<Record<string, any>>("/v3/auth/scoped-key", {
      method: "POST",
      body: JSON.stringify({ ...input, containerTag: requireContainerTag(input.containerTag) }),
    });
    const result: SupermemoryScopedKeySecret = {
      id: String(value.id),
      key: String(value.key),
      name: String(value.name ?? input.name ?? `scoped_${input.containerTag}`),
      containerTag: String(value.containerTag ?? input.containerTag),
      expiresAt: typeof value.expiresAt === "string" ? value.expiresAt : null,
      revoked: false,
    };
    const { key: _key, ...info } = result;
    await this.account.saveScopedKey(info);
    return result;
  }
  async listIssuedScopedKeys(): Promise<SupermemoryScopedKeyInfo[]> { return await this.account.listScopedKeys(); }
  async revokeScopedKey(id: string): Promise<void> {
    await this.api.request(`/v3/auth/scoped-key/${encodeURIComponent(id)}`, { method: "DELETE" });
    await this.account.markScopedKeyRevoked(id);
  }
  async getSettings(): Promise<SupermemoryOrganizationSettings> { return await this.api.getSettings(); }
  async updateSettings(update: SupermemoryOrganizationSettingsUpdate): Promise<SupermemoryOrganizationSettings> {
    await this.api.request("/v3/settings", { method: "PATCH", body: JSON.stringify(update) });
    return await this.api.getSettings();
  }
}

@validateRpc()
class ConnectionSession extends SessionBase implements SupermemoryConnection {
  constructor(api: SupermemoryApi, private readonly id: string, queue: RpcStub<ApprovalQueue>) {
    super(api, queue);
  }
  async getInfo(): Promise<SupermemoryConnectionInfo> { return await this.api.getConnection(this.id); }
  async listResources(options: SupermemoryListOptions = {}): Promise<SupermemoryConnectionResourcePage> {
    const page = options.page ?? 1;
    const limit = options.limit ?? 50;
    const value = await this.api.request<Record<string, any>>(
      `/v3/connections/${encodeURIComponent(this.id)}/resources?page=${page}&per_page=${limit}`,
    );
    return {
      resources: Array.isArray(value.resources) ? value.resources.map((item: Record<string, any>) => ({
        id: item.id,
        name: String(item.full_name ?? item.name ?? item.id),
        ...(item.default_branch ? { defaultBranch: String(item.default_branch) } : {}),
      })) : [],
      total: Number(value.total_count ?? value.resources?.length ?? 0),
    };
  }
  async configureResources(resources: SupermemoryConnectionResource[]): Promise<void> {
    await this.api.request(`/v3/connections/${encodeURIComponent(this.id)}/configure`, {
      method: "POST",
      body: JSON.stringify({ resources }),
    });
  }
  async sync(): Promise<void> {
    const info = await this.api.getConnection(this.id);
    await this.api.request(`/v3/connections/${encodeURIComponent(info.provider)}/import`, {
      method: "POST",
      body: JSON.stringify({ containerTags: info.containerTags }),
    });
  }
  async disconnect(options: { deleteImportedDocuments?: boolean } = {}): Promise<void> {
    const deleteDocuments = options.deleteImportedDocuments ?? false;
    await this.api.request(
      `/v3/connections/${encodeURIComponent(this.id)}?deleteDocuments=${deleteDocuments}`,
      { method: "DELETE" },
    );
  }
}
