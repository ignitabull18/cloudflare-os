import {
  DurableObject,
  RpcStub as NativeRpcStub,
  RpcTarget as NativeRpcTarget,
  WorkerEntrypoint,
} from "cloudflare:workers";
import { skipRpcValidation, validateRpc } from "capnweb-validate";
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
import type {
  Composio,
  ComposioConnection,
  ComposioExecution,
  ComposioTool,
  ComposioToolDetails,
  ComposioToolSummary,
} from "./types";
import { ComposioApi, type ToolkitCard } from "./composio-api.js";
import { stableComposioUserId } from "./composio-utils.js";
import TYPES_CODE from "./types.txt";
import APP_HTML from "./generated/app.txt";

type Env = Cloudflare.Env & { COMPOSIO_API_KEY: string | SecretsStoreSecret };
type AccountProps = { accountId: string };

const COMPOSIO_LOGO = {
  url: "data:image/svg+xml," + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='#8b5cf6'/><path d='M18 21h28v8H26v14h20v8H18z' fill='white'/></svg>",
  ),
};

type StoredExecution = {
  id: number;
  toolSlug: string;
  version?: string;
  arguments: Record<string, unknown>;
  state: "pending" | "applied" | "rejected" | "failed";
  submittedAt: number;
  completedAt?: number;
  successful?: boolean;
  result?: Record<string, unknown>;
  error?: string;
  logId?: string;
};

async function apiFor(env: Env, accountId: string): Promise<ComposioApi> {
  const binding = env.COMPOSIO_API_KEY;
  const apiKey = typeof binding === "string" ? binding : await binding.get();
  return new ComposioApi(apiKey, stableComposioUserId(accountId));
}

function summarizeTool(tool: Awaited<ReturnType<ComposioApi["getTool"]>>): ComposioToolSummary {
  return {
    slug: tool.slug,
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    ...(tool.toolkit ? { toolkit: tool.toolkit } : {}),
    ...(tool.version ? { version: tool.version } : {}),
  };
}

function projectExecution(record: StoredExecution): ComposioExecution {
  return {
    id: `execution:${record.id}`,
    toolSlug: record.toolSlug,
    state: record.state,
    submittedAt: new Date(record.submittedAt).toISOString(),
    ...(record.completedAt ? { completedAt: new Date(record.completedAt).toISOString() } : {}),
    ...(record.successful === undefined ? {} : { successful: record.successful }),
    ...(record.result ? { result: record.result } : {}),
    ...(record.error ? { error: record.error } : {}),
    ...(record.logId ? { logId: record.logId } : {}),
  };
}

@validateRpc()
class ComposioToolImpl extends NativeRpcTarget implements ComposioTool {
  constructor(
    private readonly tool: ComposioToolDetails,
    private readonly runTool: (tool: ComposioToolDetails, args: Record<string, unknown>) => Promise<number>,
    private readonly authorize: (title: string, description: string) => Promise<void>,
  ) {
    super();
  }

  async describe(): Promise<ComposioToolDetails> {
    await this.authorize(`Inspect ${this.tool.name}`, `Read the schema for ${this.tool.slug}.`);
    return this.tool;
  }

  async run(args: Record<string, unknown>): Promise<{ executionId: string }> {
    const id = await this.runTool(this.tool, args);
    return { executionId: `execution:${id}` };
  }
}

@validateRpc()
class ComposioSessionImpl extends NativeRpcTarget implements Composio {
  constructor(
    private readonly api: ComposioApi,
    private readonly kv: DurableObjectStorage["kv"],
    private readonly queue: NativeRpcStub<ApprovalQueue>,
  ) {
    super();
  }

  async searchTools(
    query: string,
    options?: { toolkit?: string; limit?: number },
  ): Promise<ComposioToolSummary[]> {
    const tools = await this.api.searchTools(query, options?.toolkit, options?.limit);
    await this.queue.authorizeObservation({
      title: "Search Composio tools",
      description: `Search the Composio catalog for ${JSON.stringify(query)}.`,
    });
    return tools.map(summarizeTool);
  }

  async getTool(slug: string): Promise<ComposioTool> {
    const tool = await this.api.getTool(slug);
    const details: ComposioToolDetails = {
      ...summarizeTool(tool),
      ...(tool.inputParameters ? { inputParameters: tool.inputParameters } : {}),
      ...(tool.outputParameters ? { outputParameters: tool.outputParameters } : {}),
      ...(tool.tags ? { tags: tool.tags } : {}),
    };
    await this.queue.authorizeObservation({
      title: `Inspect ${tool.name}`,
      description: `Read metadata for Composio tool ${tool.slug}.`,
    });
    return new ComposioToolImpl(
      details,
      (selected, args) => this.#stage(selected, args),
      (title, description) => this.queue.authorizeObservation({ title, description }),
    );
  }

  async listConnections(): Promise<ComposioConnection[]> {
    const connections = await this.api.listConnections();
    await this.queue.authorizeObservation({
      title: "List Composio connections",
      description: "Read which apps are connected through Composio and their authentication state.",
    });
    return connections;
  }

  async getExecution(executionId: string): Promise<ComposioExecution | null> {
    const match = /^execution:(\d+)$/.exec(executionId);
    if (!match) throw new Error("Invalid Composio execution ID.");
    const record = this.kv.get<StoredExecution>(`execution:${match[1]}`);
    await this.queue.authorizeObservation({
      title: "Read Composio execution",
      description: `Read the current state of ${executionId}.`,
    });
    return record ? projectExecution(record) : null;
  }

  async #stage(tool: ComposioToolDetails, args: Record<string, unknown>): Promise<number> {
    const id = this.kv.get<number>("execution-sequence") ?? 1;
    this.kv.put("execution-sequence", id + 1);
    const record: StoredExecution = {
      id,
      toolSlug: tool.slug,
      ...(tool.version ? { version: tool.version } : {}),
      arguments: args,
      state: "pending",
      submittedAt: Date.now(),
    };
    this.kv.put(`execution:${id}`, record);
    try {
      await this.queue.submitAction(id, {
        title: `Run ${tool.name}`,
        description: `Execute Composio tool \`${tool.slug}\` with the supplied structured arguments.`,
        implementsRevert: false,
      });
    } catch (error) {
      this.kv.delete(`execution:${id}`);
      throw error;
    }
    return id;
  }
}

@validateRpc()
export class ComposioGatekeeper
  extends DurableObject<Env, AccountProps>
  implements Gatekeeper<Composio>
{
  async describe(): Promise<ResourceDescription> {
    return {
      url: "composio://tools",
      title: "Composio",
      snippet: "Discover and run tools through your connected Composio apps.",
      suggestedBindingName: "COMPOSIO",
      tsType: "Composio",
    };
  }

  async getTypeScriptTypes(): Promise<string> { return TYPES_CODE; }
  async getAutoApprovableActions(): Promise<ActionKind[]> { return []; }

  async startSession(queue: NativeRpcStub<ApprovalQueue>): Promise<Composio> {
    return new ComposioSessionImpl(
      await apiFor(this.env, this.ctx.props.accountId),
      this.ctx.storage.kv,
      queue.dup(),
    );
  }

  async getAgentCatalog(
    request: AgentCatalogRequest,
    authorizer: NativeRpcStub<ObservationAuthorizer>,
  ): Promise<AgentCatalog> {
    const connections = await (await apiFor(this.env, this.ctx.props.accountId)).listConnections();
    await authorizer.authorizeObservation({
      title: "Discover connected Composio apps",
      description: "Read the bounded list of apps available through this Composio account.",
    });
    return boundAgentCatalog(connections.map(connection => ({
      id: connection.toolkit,
      title: connection.toolkit,
      description: `${connection.status} Composio connection`,
    })), request);
  }

  async applyAction(action: number): Promise<void> {
    const key = `execution:${action}`;
    const record = this.ctx.storage.kv.get<StoredExecution>(key);
    if (!record || record.state !== "pending") {
      throw new Error(`Unknown pending Composio execution: ${action}`);
    }
    try {
      const response = await (await apiFor(this.env, this.ctx.props.accountId)).execute(
        record.toolSlug,
        record.version,
        record.arguments,
      );
      record.state = "applied";
      record.completedAt = Date.now();
      record.successful = response.successful;
      record.result = response.data;
      record.error = response.error ?? undefined;
      record.logId = response.logId;
      this.ctx.storage.kv.put(key, record);
    } catch (error) {
      record.state = "failed";
      record.completedAt = Date.now();
      record.error = error instanceof Error ? error.message : String(error);
      this.ctx.storage.kv.put(key, record);
      throw error;
    }
  }

  async rejectAction(action: number): Promise<void> {
    const key = `execution:${action}`;
    const record = this.ctx.storage.kv.get<StoredExecution>(key);
    if (!record) return;
    record.state = "rejected";
    record.completedAt = Date.now();
    this.ctx.storage.kv.put(key, record);
  }

  async revertAction(_action: number): Promise<{ message: string }> {
    return { message: "Composio tool executions cannot be reverted generically. Reverse the change in the connected app when supported." };
  }

  async addObserver(): Promise<void> {
    throw new Error("Composio account-wide bindings are private and cannot be shared with collaborators.");
  }

  async removeObserver(_id: string): Promise<void> {}
}

export type ComposioManagementPage = { items: ToolkitCard[] };

@validateRpc()
export class ComposioManagementApi extends NativeRpcTarget {
  constructor(private readonly api: ComposioApi) { super(); }

  async listToolkits(search?: string): Promise<ComposioManagementPage> {
    return { items: (await this.api.listToolkits(search)).slice(0, 100) };
  }

  async connect(toolkit: string): Promise<{ url: string }> {
    return { url: await this.api.authorize(toolkit) };
  }

  async disconnect(connectionId: string): Promise<void> {
    await this.api.deleteConnection(connectionId);
  }
}

@validateRpc()
export class ComposioVerifier extends WorkerEntrypoint<Env> implements GatekeeperUserVerifier {
  verify(): void {}
}

@validateRpc()
export class ComposioAccount
  extends WorkerEntrypoint<Env, AccountProps>
  implements GatekeeperUser
{
  async describe(): Promise<AccountDescription> {
    return {
      displayName: "Composio",
      avatar: COMPOSIO_LOGO,
      singleton: { tsType: "Composio" },
      providesUi: { title: "Composio", icon: COMPOSIO_LOGO, showInNavigation: false },
    };
  }

  async getSingletonGatekeeperClass(): Promise<DurableObjectClass<Gatekeeper<Composio>>> {
    return this.ctx.exports.ComposioGatekeeper({ props: this.ctx.props });
  }

  async startAppUi(_context: AppUiContext): Promise<GatekeeperUiFrame> {
    const ui = new NativeRpcStub(new ComposioManagementApi(
      await apiFor(this.env, this.ctx.props.accountId),
    ));
    return { iframeHtml: APP_HTML, ui };
  }

  async getSupportedResources(): Promise<SupportedResource[]> { return []; }
  getGatekeeperClassFor(_url: string): never {
    throw new Error("Composio is an account singleton and has no URL-addressed resources.");
  }
  startResourceConfigurator(_pattern: string): Promise<ResourceConfiguratorFrame> {
    throw new Error("Composio has no URL-addressed resources.");
  }
  async ensureResources(_patterns: string[]): Promise<{ url?: string }> { return {}; }
  reconnect(): Promise<{ url: string }> {
    throw new Error("Reconnect individual apps from the Composio management page.");
  }
  async getAuthenticatedEmail(): Promise<string | null> { return null; }

  async revoke(): Promise<void> {
    await (await apiFor(this.env, this.ctx.props.accountId)).revokeAll();
  }

  @skipRpcValidation()
  async getVerifier(): Promise<Fetcher<GatekeeperUserVerifier>> {
    return this.ctx.exports.ComposioVerifier({});
  }
}

@validateRpc()
export class GatekeeperVendor extends WorkerEntrypoint<Env> {
  async describe(): Promise<VendorDescription> {
    return {
      displayName: "Composio",
      url: "https://composio.dev/",
      logo: COMPOSIO_LOGO,
      color: "#ede9fe",
      tagline: "Connect apps and run their tools",
      description: "Connect supported services through Composio and give agents a discoverable, approval-gated tool catalog. Composio stores and refreshes each provider's credentials.",
      autoProvisionsAccount: true,
      providesAuth: false,
    };
  }

  @skipRpcValidation()
  async createAccount(): Promise<Fetcher<GatekeeperUser>> {
    return this.ctx.exports.ComposioAccount({
      props: { accountId: crypto.randomUUID() },
    }) as unknown as Fetcher<GatekeeperUser>;
  }

  connectAccount(
    _callback: Fetcher<GatekeeperConnectCallback>,
    _options?: GatekeeperConnectOptions,
  ): Promise<{ url: string }> {
    throw new Error("Composio is auto-provisioned and has no top-level connect flow.");
  }

  async getSupportedResources(_options?: { userId?: string }): Promise<SupportedResource[]> { return []; }
  async getTypeScriptTypes(): Promise<string> { return TYPES_CODE; }
}

export default {
  async fetch(): Promise<Response> {
    return new Response("Composio gatekeeper is running.", {
      headers: { "content-type": "text/plain" },
    });
  },
};
