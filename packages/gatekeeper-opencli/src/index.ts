import {
  DurableObject,
  RpcStub as NativeRpcStub,
  RpcTarget as NativeRpcTarget,
  WorkerEntrypoint,
} from "cloudflare:workers";
import { Sandbox } from "@cloudflare/sandbox";
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
  OpenCLI,
  OpenCliCommand,
  OpenCliCommandDetails,
  OpenCliCommandSummary,
  OpenCliConnectionStatus,
  OpenCliExecution,
} from "./types";
import { OpenCliDriver, type CommandDescriptor, type OpenCliEnv } from "./driver.js";
import TYPES_CODE from "./types.txt";
import APP_HTML from "./generated/app.txt";

export { Sandbox, OpenCliDriver };

type AccountProps = { accountId: string };

const OPENCLI_LOGO = {
  url: "data:image/svg+xml," + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='#111827'/><path d='m17 21 11 11-11 11 5 5 16-16-16-16zm20 22h12v7H37z' fill='#7dd3fc'/></svg>",
  ),
};

type StoredExecution = {
  id: number;
  command: string;
  argv: string[];
  access: "read" | "write";
  state: "pending" | "applied" | "rejected" | "failed";
  submittedAt: number;
  completedAt?: number;
  output?: unknown;
  error?: string;
};

function projectCommand(command: CommandDescriptor): OpenCliCommandDetails {
  return {
    command: command.command,
    site: command.site,
    name: command.name,
    description: command.description,
    access: command.access,
    browser: command.browser,
    ...(command.domain ? { domain: command.domain } : {}),
    args: command.args,
    ...(command.strategy ? { strategy: command.strategy } : {}),
    ...(command.example ? { example: command.example } : {}),
    ...(command.siteSession ? { siteSession: command.siteSession } : {}),
  };
}

function summary(command: CommandDescriptor): OpenCliCommandSummary {
  const { args: _args, strategy: _strategy, example: _example, siteSession: _siteSession, ...value } =
    projectCommand(command);
  return value;
}

function projectExecution(record: StoredExecution): OpenCliExecution {
  return {
    id: `execution:${record.id}`,
    command: record.command,
    access: record.access,
    state: record.state,
    submittedAt: new Date(record.submittedAt).toISOString(),
    ...(record.completedAt ? { completedAt: new Date(record.completedAt).toISOString() } : {}),
    ...(record.output === undefined ? {} : { output: record.output }),
    ...(record.error ? { error: record.error } : {}),
  };
}

function parseCommandOutput(output: string): unknown {
  if (!output) return null;
  try { return JSON.parse(output) as unknown; } catch { return output; }
}

@validateRpc()
class OpenCliCommandImpl extends NativeRpcTarget implements OpenCliCommand {
  constructor(
    private readonly command: OpenCliCommandDetails,
    private readonly runCommand: (argv: string[]) => Promise<number>,
    private readonly authorize: (title: string, description: string) => Promise<void>,
  ) { super(); }

  async describe(): Promise<OpenCliCommandDetails> {
    await this.authorize(
      `Inspect ${this.command.command}`,
      `Read the registered OpenCLI arguments and access classification for ${this.command.command}.`,
    );
    return this.command;
  }

  async run(argv: string[] = []): Promise<{ executionId: string }> {
    return { executionId: `execution:${await this.runCommand(argv)}` };
  }
}

@validateRpc()
class OpenCliSessionImpl extends NativeRpcTarget implements OpenCLI {
  constructor(
    private readonly driver: DurableObjectStub<OpenCliDriver>,
    private readonly kv: DurableObjectStorage["kv"],
    private readonly queue: NativeRpcStub<ApprovalQueue>,
  ) { super(); }

  async searchCommands(
    query: string,
    options?: { site?: string; access?: "read" | "write"; limit?: number },
  ): Promise<OpenCliCommandSummary[]> {
    const commands = await this.driver.searchCommands(query, options);
    await this.queue.authorizeObservation({
      title: "Search OpenCLI commands",
      description: `Search registered OpenCLI adapters for ${JSON.stringify(query)}.`,
    });
    return commands.map(summary);
  }

  async getCommand(commandName: string): Promise<OpenCliCommand> {
    const command = projectCommand(await this.driver.getCommand(commandName));
    await this.queue.authorizeObservation({
      title: `Inspect ${commandName}`,
      description: `Read registered metadata for OpenCLI command ${commandName}.`,
    });
    return new OpenCliCommandImpl(
      command,
      argv => this.#run(command, argv),
      (title, description) => this.queue.authorizeObservation({ title, description }),
    );
  }

  async connectionStatus(): Promise<OpenCliConnectionStatus> {
    const status = await this.driver.status();
    await this.queue.authorizeObservation({
      title: "Read OpenCLI connection status",
      description: "Read browser profile, checkpoint, and warm-session status.",
    });
    return status;
  }

  async getExecution(executionId: string): Promise<OpenCliExecution | null> {
    const match = /^execution:(\d+)$/.exec(executionId);
    if (!match) throw new Error("Invalid OpenCLI execution ID.");
    const record = this.kv.get<StoredExecution>(`execution:${match[1]}`);
    await this.queue.authorizeObservation({
      title: "Read OpenCLI execution",
      description: `Read the current state and output of ${executionId}.`,
    });
    return record ? projectExecution(record) : null;
  }

  async #run(command: OpenCliCommandDetails, argv: string[]): Promise<number> {
    const id = this.kv.get<number>("execution-sequence") ?? 1;
    this.kv.put("execution-sequence", id + 1);
    const record: StoredExecution = {
      id,
      command: command.command,
      argv,
      access: command.access,
      state: "pending",
      submittedAt: Date.now(),
    };
    this.kv.put(`execution:${id}`, record);
    if (command.access === "write") {
      try {
        await this.queue.submitAction(id, {
          title: `Run ${command.command}`,
          description: `Execute the registered OpenCLI write command \`${command.command}\`.`,
          implementsRevert: false,
        });
      } catch (error) {
        this.kv.delete(`execution:${id}`);
        throw error;
      }
      return id;
    }
    await this.queue.authorizeObservation({
      title: `Run ${command.command}`,
      description: `Run the registered read-only OpenCLI command \`${command.command}\`.`,
    });
    try {
      record.output = parseCommandOutput(await this.driver.run(command.command, argv));
      record.state = "applied";
      record.completedAt = Date.now();
      this.kv.put(`execution:${id}`, record);
      return id;
    } catch (error) {
      record.state = "failed";
      record.completedAt = Date.now();
      record.error = error instanceof Error ? error.message : String(error);
      this.kv.put(`execution:${id}`, record);
      throw error;
    }
  }
}

@validateRpc()
export class OpenCliGatekeeper
  extends DurableObject<OpenCliEnv, AccountProps>
  implements Gatekeeper<OpenCLI>
{
  #driver(): DurableObjectStub<OpenCliDriver> {
    return this.ctx.exports.OpenCliDriver.getByName(this.ctx.props.accountId);
  }

  async describe(): Promise<ResourceDescription> {
    return {
      url: "opencli://commands",
      title: "OpenCLI",
      snippet: "Use registered website adapters through a persistent browser profile.",
      suggestedBindingName: "OPENCLI",
      tsType: "OpenCLI",
    };
  }

  async getTypeScriptTypes(): Promise<string> { return TYPES_CODE; }
  async getAutoApprovableActions(): Promise<ActionKind[]> { return []; }

  async startSession(queue: NativeRpcStub<ApprovalQueue>): Promise<OpenCLI> {
    return new OpenCliSessionImpl(this.#driver(), this.ctx.storage.kv, queue.dup());
  }

  async getAgentCatalog(
    request: AgentCatalogRequest,
    authorizer: NativeRpcStub<ObservationAuthorizer>,
  ): Promise<AgentCatalog> {
    const commands = await this.#driver().searchCommands("", { limit: request.limit });
    await authorizer.authorizeObservation({
      title: "Discover OpenCLI commands",
      description: "Read a bounded catalog of registered OpenCLI website commands.",
    });
    return boundAgentCatalog(commands.map(command => ({
      id: command.command,
      title: command.command,
      description: command.description,
    })), request);
  }

  async applyAction(action: number): Promise<void> {
    const key = `execution:${action}`;
    const record = this.ctx.storage.kv.get<StoredExecution>(key);
    if (!record || record.state !== "pending" || record.access !== "write") {
      throw new Error(`Unknown pending OpenCLI write execution: ${action}`);
    }
    try {
      record.output = parseCommandOutput(await this.#driver().run(record.command, record.argv));
      record.state = "applied";
      record.completedAt = Date.now();
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
    return { message: "OpenCLI website actions cannot be reverted generically. Reverse the change on the website when supported." };
  }

  async addObserver(): Promise<void> {
    throw new Error("OpenCLI browser sessions are private and cannot be shared with collaborators.");
  }
  async removeObserver(_id: string): Promise<void> {}
}

@validateRpc()
export class OpenCliManagementApi extends NativeRpcTarget {
  constructor(private readonly driver: DurableObjectStub<OpenCliDriver>) { super(); }
  status(): Promise<OpenCliConnectionStatus> { return this.driver.status(); }
  searchSites(query?: string): Promise<Array<{ site: string; description: string; domain?: string }>> {
    return this.driver.searchCommands(query ?? "", { limit: 50 }).then(commands => {
      const sites = new Map<string, { site: string; description: string; domain?: string }>();
      for (const command of commands) {
        if (!sites.has(command.site)) sites.set(command.site, {
          site: command.site,
          description: command.description,
          ...(command.domain ? { domain: command.domain } : {}),
        });
      }
      return [...sites.values()].slice(0, 50);
    });
  }
  beginLogin(site: string): Promise<{ url: string }> { return this.driver.beginLogin(site); }
  finishLogin(): Promise<void> { return this.driver.finishLogin(); }
  setWarm(mode: "on-demand" | "bounded" | "always", minutes?: number): Promise<void> {
    return this.driver.setWarm(mode, minutes);
  }
  checkpoint(): Promise<void> { return this.driver.checkpoint(); }
}

@validateRpc()
export class OpenCliVerifier extends WorkerEntrypoint<OpenCliEnv> implements GatekeeperUserVerifier {
  verify(): void {}
}

@validateRpc()
export class OpenCliAccount
  extends WorkerEntrypoint<OpenCliEnv, AccountProps>
  implements GatekeeperUser
{
  #driver(): DurableObjectStub<OpenCliDriver> {
    return this.ctx.exports.OpenCliDriver.getByName(this.ctx.props.accountId);
  }
  async describe(): Promise<AccountDescription> {
    return {
      displayName: "OpenCLI",
      avatar: OPENCLI_LOGO,
      singleton: { tsType: "OpenCLI" },
      providesUi: { title: "OpenCLI", icon: OPENCLI_LOGO, showInNavigation: false },
    };
  }
  async getSingletonGatekeeperClass(): Promise<DurableObjectClass<Gatekeeper<OpenCLI>>> {
    return this.ctx.exports.OpenCliGatekeeper({ props: this.ctx.props });
  }
  async startAppUi(_context: AppUiContext): Promise<GatekeeperUiFrame> {
    return { iframeHtml: APP_HTML, ui: new NativeRpcStub(new OpenCliManagementApi(this.#driver())) };
  }
  async getSupportedResources(): Promise<SupportedResource[]> { return []; }
  getGatekeeperClassFor(_url: string): never {
    throw new Error("OpenCLI is an account singleton and has no URL-addressed resources.");
  }
  startResourceConfigurator(_pattern: string): Promise<ResourceConfiguratorFrame> {
    throw new Error("OpenCLI has no URL-addressed resources.");
  }
  async ensureResources(_patterns: string[]): Promise<{ url?: string }> { return {}; }
  reconnect(): Promise<{ url: string }> {
    throw new Error("Open the OpenCLI management page to sign in to a website.");
  }
  async getAuthenticatedEmail(): Promise<string | null> { return null; }
  async revoke(): Promise<void> { await this.#driver().revoke(); }
  @skipRpcValidation()
  async getVerifier(): Promise<Fetcher<GatekeeperUserVerifier>> {
    return this.ctx.exports.OpenCliVerifier({});
  }
}

@validateRpc()
export class GatekeeperVendor extends WorkerEntrypoint<OpenCliEnv> {
  async describe(): Promise<VendorDescription> {
    return {
      displayName: "OpenCLI",
      url: "https://github.com/jackwener/opencli",
      logo: OPENCLI_LOGO,
      color: "#e0f2fe",
      tagline: "Use websites through registered commands",
      description: "Run registered OpenCLI website adapters in a private Cloudflare Sandbox. The complete Chromium profile is checkpointed to R2, and optional warm sessions use the Sandbox SDK keep-alive lifecycle.",
      autoProvisionsAccount: true,
      providesAuth: false,
    };
  }
  @skipRpcValidation()
  async createAccount(): Promise<Fetcher<GatekeeperUser>> {
    return this.ctx.exports.OpenCliAccount({ props: { accountId: crypto.randomUUID() } }) as unknown as Fetcher<GatekeeperUser>;
  }
  connectAccount(
    _callback: Fetcher<GatekeeperConnectCallback>,
    _options?: GatekeeperConnectOptions,
  ): Promise<{ url: string }> {
    throw new Error("OpenCLI is auto-provisioned and has no top-level connect flow.");
  }
  async getSupportedResources(_options?: { userId?: string }): Promise<SupportedResource[]> { return []; }
  async getTypeScriptTypes(): Promise<string> { return TYPES_CODE; }
}

export default {
  async fetch(): Promise<Response> {
    return new Response("OpenCLI gatekeeper is running.", { headers: { "content-type": "text/plain" } });
  },
};
