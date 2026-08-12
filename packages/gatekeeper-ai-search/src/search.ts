import {
  DurableObject,
  RpcStub as NativeRpcStub,
  RpcTarget,
  WorkerEntrypoint,
} from "cloudflare:workers";
import { boundAgentCatalog } from "@gadgets/workshop-shared/gatekeeper";
import type {
  AccountDescription,
  ActionKind,
  AgentCatalog,
  AgentCatalogRequest,
  AppUiContext,
  ApprovalQueue,
  Gatekeeper,
  GatekeeperConnectCallback,
  GatekeeperConnectOptions,
  GatekeeperUiFrame,
  GatekeeperUser,
  GatekeeperUserVerifier,
  ObservationAuthorizer,
  ResourceConfiguratorFrame,
  ResourceDescription,
  SupportedResource,
  VendorDescription,
} from "@gadgets/workshop-shared/gatekeeper";
import { skipRpcValidation, validateRpc } from "capnweb-validate";
import APP_HTML from "./generated/app.txt";
import {
  mapSearchMatches,
  normalizeSearchInput,
  normalizeSearchOptions,
} from "./search-core.js";
import TYPES_CODE from "./types.txt";
import type {
  AiSearchLibrary,
  LibrarySummary,
  ManagedSearchItem,
  SearchAnswer,
  SearchMatch,
  SearchOptions,
} from "./types.js";

const SEARCH_ICON = {
  url: "data:image/svg+xml," + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256' fill='currentColor'>" +
      "<path d='m229.66 218.34-50.07-50.06a88.11 88.11 0 1 0-11.31 11.31l50.06 50.07a8 8 0 0 0 11.32-11.32ZM40 112a72 72 0 1 1 72 72 72.08 72.08 0 0 1-72-72Z'/></svg>",
  ),
};

const MAX_ANSWER_LENGTH = 32_000;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_FILENAME_LENGTH = 240;

type AiSearchAccountProps = { instanceId: string };

interface AiSearchVerifierApi extends GatekeeperUserVerifier {
  getInstanceId(): Promise<string>;
}

function mapManagedItem(item: AiSearchItemInfo): ManagedSearchItem {
  return {
    id: item.id,
    name: item.key,
    status: item.status,
    ...(item.chunks_count === null || item.chunks_count === undefined
      ? {} : { chunks: item.chunks_count }),
    ...(item.file_size === null || item.file_size === undefined ? {} : { size: item.file_size }),
    ...(item.error ? { error: item.error.slice(0, 1_000) } : {}),
  };
}

/** Read-only agent session over one account's private AI Search instance. */
@validateRpc()
export class AiSearchSession extends RpcTarget implements AiSearchLibrary {
  constructor(
    private readonly instance: AiSearchInstance,
    private readonly authorizer: NativeRpcStub<ObservationAuthorizer>,
  ) {
    super();
  }

  /** Searches private indexed documents and records the disclosure as an observation. */
  async search(query: string, options?: SearchOptions): Promise<SearchMatch[]> {
    const normalizedQuery = normalizeSearchInput(query, "Search query");
    const normalized = normalizeSearchOptions(options);
    const response = await this.instance.search({
      query: normalizedQuery,
      ai_search_options: {
        retrieval: {
          retrieval_type: "hybrid",
          max_num_results: normalized.limit,
          match_threshold: normalized.threshold,
        },
      },
    });
    const matches = mapSearchMatches(response.chunks, normalized.limit);
    await this.authorizer.authorizeObservation({
      title: "Search private AI library",
      description: `Returned ${matches.length} indexed document chunk(s).`,
    });
    return matches;
  }

  /** Generates a grounded answer and records its sources as an observation. */
  async answer(question: string, options?: SearchOptions): Promise<SearchAnswer> {
    const normalizedQuestion = normalizeSearchInput(question, "Question");
    const normalized = normalizeSearchOptions(options);
    const response = await this.instance.chatCompletions({
      messages: [{ role: "user", content: normalizedQuestion }],
      ai_search_options: {
        retrieval: {
          retrieval_type: "hybrid",
          max_num_results: normalized.limit,
          match_threshold: normalized.threshold,
        },
      },
    });
    const sources = mapSearchMatches(response.chunks, normalized.limit);
    await this.authorizer.authorizeObservation({
      title: "Answer from private AI library",
      description: `Generated an answer grounded in ${sources.length} indexed chunk(s).`,
    });
    return {
      text: (response.choices[0]?.message.content ?? "").slice(0, MAX_ANSWER_LENGTH),
      sources,
    };
  }

  [Symbol.dispose](): void {
    this.authorizer[Symbol.dispose]?.();
  }
}

/** Human-authorized management API for the account's private search library. */
@validateRpc()
export class AiSearchManagementApi extends RpcTarget {
  constructor(
    private readonly instanceId: string,
    private readonly instance: AiSearchInstance,
  ) {
    super();
  }

  /** Returns current instance statistics and the first document page. */
  async summary(): Promise<LibrarySummary> {
    const [info, stats, items] = await Promise.all([
      this.instance.info(),
      this.instance.stats(),
      this.instance.items.list({ page: 1, per_page: 50, sort_by: "modified_at" }),
    ]);
    return {
      instanceId: this.instanceId,
      status: info.status,
      objectCount: stats.engine?.r2?.objectCount ?? items.result.length,
      items: items.result.map(mapManagedItem),
    };
  }

  /** Uploads or replaces one document and starts indexing it. */
  async upload(name: string, content: Uint8Array, contentType?: string): Promise<ManagedSearchItem> {
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > MAX_FILENAME_LENGTH || /[\\/]/.test(normalizedName)) {
      throw new TypeError("Filename must be a plain name between 1 and 240 characters.");
    }
    if (content.byteLength === 0 || content.byteLength > MAX_UPLOAD_BYTES) {
      throw new TypeError("Document must be between 1 byte and 10 MiB.");
    }
    const copy = new Uint8Array(content);
    const payload = contentType?.startsWith("text/")
      ? new TextDecoder().decode(copy)
      : new Blob([copy.buffer], { type: contentType || "application/octet-stream" }).stream();
    const item = await this.instance.items.upload(
      normalizedName,
      payload,
    );
    return mapManagedItem(item);
  }

  /** Reindexes one existing document. */
  async sync(itemId: string): Promise<ManagedSearchItem> {
    return mapManagedItem(
      await this.instance.items.get(normalizeSearchInput(itemId, "Item ID")).sync(),
    );
  }

  /** Permanently removes one document from the private library. */
  async delete(itemId: string): Promise<void> {
    await this.instance.items.delete(normalizeSearchInput(itemId, "Item ID"));
  }
}

/** Gadget-side gatekeeper facet scoped to one private AI Search instance. */
@validateRpc()
export class AiSearchGatekeeper
  extends DurableObject<Cloudflare.Env, AiSearchAccountProps>
  implements Gatekeeper<AiSearchSession>
{
  /** Describes the ambient private search binding. */
  async describe(): Promise<ResourceDescription> {
    return {
      url: `ai-search://library/${this.ctx.props.instanceId}`,
      title: "AI Search",
      snippet: "Search and answer questions from your private indexed documents.",
      suggestedBindingName: "AI_SEARCH",
      tsType: "AiSearchLibrary",
    };
  }

  /** Returns the agent-facing declaration source. */
  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }

  /** Opens an observation-authorized session over the account's instance. */
  async startSession(approvalQueue: NativeRpcStub<ApprovalQueue>): Promise<AiSearchSession> {
    return new AiSearchSession(
      this.env.AI_SEARCH.get(this.ctx.props.instanceId),
      approvalQueue.dup(),
    );
  }

  /** Returns bounded document discovery metadata after observation authorization. */
  async getAgentCatalog(
    request: AgentCatalogRequest,
    authorizer: NativeRpcStub<ObservationAuthorizer>,
  ): Promise<AgentCatalog> {
    const limit = Number.isFinite(request.limit)
      ? Math.max(1, Math.min(Math.floor(request.limit), 25))
      : 1;
    const response = await this.env.AI_SEARCH.get(this.ctx.props.instanceId).items.list({
      page: 1,
      per_page: limit,
      sort_by: "modified_at",
    });
    const catalog = boundAgentCatalog(response.result.map((item) => ({
      id: item.id,
      title: item.key,
      description: item.status === "completed"
        ? `Indexed document with ${item.chunks_count ?? 0} searchable chunk(s).`
        : `Document indexing status: ${item.status}.`,
    })), request);
    if (catalog.entries.length > 0) {
      await authorizer.authorizeObservation({
        title: "List private AI library",
        description: `Listed ${catalog.entries.length} indexed document(s).`,
      });
    }
    return catalog;
  }

  /** Reports that the read-only singleton has no auto-applicable actions. */
  async getAutoApprovableActions(): Promise<ActionKind[]> {
    return [];
  }

  /** Allows sharing only when the observer independently owns the same private library. */
  async addObserver(_id: string, user: Fetcher<GatekeeperUserVerifier>): Promise<void> {
    const verifier = user as Fetcher<AiSearchVerifierApi>;
    if (await verifier.getInstanceId() !== this.ctx.props.instanceId) {
      throw new Error("The observer cannot access this private AI Search library.");
    }
  }

  /** Removes an observer; no observer state is retained. */
  async removeObserver(_id: string): Promise<void> {}

  /** Rejects action application because this gatekeeper submits no actions. */
  applyAction(_action: number): Promise<void> {
    throw new Error("AI Search is read-only and implements no actions.");
  }

  /** Rejects action rejection because this gatekeeper submits no actions. */
  rejectAction(_action: number): Promise<void> {
    throw new Error("AI Search is read-only and implements no actions.");
  }

  /** Rejects action reversion because this gatekeeper submits no actions. */
  revertAction(
    _action: number,
  ): Promise<void | { message?: string; canRetry?: boolean; restart?: boolean }> {
    throw new Error("AI Search is read-only and implements no actions.");
  }
}

/** Account capability for one auto-provisioned private AI Search instance. */
@validateRpc()
export class AiSearchAccount
  extends WorkerEntrypoint<Cloudflare.Env, AiSearchAccountProps>
  implements GatekeeperUser
{
  /** Describes the ambient singleton and its document-management page. */
  async describe(): Promise<AccountDescription> {
    return {
      displayName: "AI Search",
      avatar: SEARCH_ICON,
      singleton: { tsType: "AiSearchLibrary" },
      providesUi: { title: "AI Search", icon: SEARCH_ICON },
    };
  }

  /** Returns the account-scoped gadget-side gatekeeper class. */
  async getSingletonGatekeeperClass(): Promise<DurableObjectClass<Gatekeeper<AiSearchSession>>> {
    return this.ctx.exports.AiSearchGatekeeper({ props: this.ctx.props });
  }

  /** Opens the document-management frame. */
  async startAppUi(_context: AppUiContext): Promise<GatekeeperUiFrame> {
    const instance = this.env.AI_SEARCH.get(this.ctx.props.instanceId);
    return {
      iframeHtml: APP_HTML,
      ui: new NativeRpcStub(new AiSearchManagementApi(this.ctx.props.instanceId, instance)),
    };
  }

  /** Returns no URL-addressed resource types. */
  async getSupportedResources(): Promise<SupportedResource[]> {
    return [];
  }

  /** Rejects URL resource lookup because this account is ambient-only. */
  getGatekeeperClassFor(_url: string): Promise<never> {
    throw new Error("AI Search has no URL-addressed resources.");
  }

  /** Rejects resource configuration because this account is ambient-only. */
  startResourceConfigurator(_resourceUrlPattern: string): Promise<ResourceConfiguratorFrame> {
    throw new Error("AI Search has no URL-addressed resources.");
  }

  /** Confirms there are no OAuth resource scopes to expand. */
  async ensureResources(_resourceUrlPatterns: string[]): Promise<{ url?: string }> {
    return {};
  }

  /** Deletes the private AI Search instance and all indexed documents. */
  async revoke(): Promise<void> {
    await this.env.AI_SEARCH.delete(this.ctx.props.instanceId);
  }

  /** Rejects reconnect because this singleton has no credential flow. */
  reconnect(): Promise<{ url: string }> {
    throw new Error("AI Search is auto-provisioned and has no connect flow.");
  }

  /** Returns no authentication identity. */
  async getAuthenticatedEmail(): Promise<string | null> {
    return null;
  }

  /** Mints a verifier tied to this private instance. */
  @skipRpcValidation()
  async getVerifier(): Promise<Fetcher<GatekeeperUserVerifier>> {
    return this.ctx.exports.AiSearchVerifier({ props: this.ctx.props });
  }
}

/** Verifies independent access to one account's private AI Search instance. */
@validateRpc()
export class AiSearchVerifier
  extends WorkerEntrypoint<Cloudflare.Env, AiSearchAccountProps>
  implements GatekeeperUserVerifier, AiSearchVerifierApi
{
  /** Returns the opaque instance authority represented by this verifier. */
  async getInstanceId(): Promise<string> {
    return this.ctx.props.instanceId;
  }
}

/** Auto-provisioning vendor entrypoint for Cloudflare AI Search. */
@validateRpc()
export class GatekeeperVendor extends WorkerEntrypoint<Cloudflare.Env> {
  /** Describes the deployment-owned AI Search service. */
  async describe(): Promise<VendorDescription> {
    return {
      displayName: "AI Search",
      url: "https://developers.cloudflare.com/ai-search/",
      logo: SEARCH_ICON,
      tagline: "Search and answer from your private documents",
      description:
        "Upload private documents into a Cloudflare-managed search library. Agents can search " +
        "and answer from indexed sources through an observation-authorized capability.",
      autoProvisionsAccount: true,
      providesAuth: false,
    };
  }

  /** Creates a fresh private built-in-storage AI Search instance and account capability. */
  @skipRpcValidation()
  async createAccount(): Promise<Fetcher<GatekeeperUser>> {
    const instanceId = `gk-${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
    await this.env.AI_SEARCH.create({
      id: instanceId,
      index_method: { vector: true, keyword: true },
      fusion_method: "rrf",
    });
    return this.ctx.exports.AiSearchAccount({ props: { instanceId } });
  }

  /** Rejects interactive connection because accounts are auto-provisioned. */
  connectAccount(
    _callback: Fetcher<GatekeeperConnectCallback>,
    _options?: GatekeeperConnectOptions,
  ): Promise<{ url: string }> {
    throw new Error("AI Search is auto-provisioned and has no connect flow.");
  }

  /** Returns no URL-addressed resource types. */
  async getSupportedResources(_options?: { userId?: string }): Promise<SupportedResource[]> {
    return [];
  }

  /** Returns the complete agent-facing declaration source. */
  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }
}
