import { DurableObject } from "cloudflare:workers";
import { getSandbox, type DirectoryBackup, type Sandbox as SandboxClass } from "@cloudflare/sandbox";
import { createLogger } from "@gadgets/backend-utils/logger";
import { isCommandDescriptor, shellQuote } from "./command-utils.js";
import { sandboxIdForDurableObject } from "./sandbox-id.js";

export type OpenCliEnv = Cloudflare.Env & {
  Sandbox: DurableObjectNamespace<SandboxClass>;
  BACKUP_BUCKET: R2Bucket;
  OPENCLI_LOCAL_BACKUPS?: string;
};

export type CommandDescriptor = {
  command: string;
  site: string;
  name: string;
  description: string;
  access: "read" | "write";
  browser: boolean;
  domain?: string;
  args: Array<{
    name: string;
    type: string;
    required: boolean;
    positional: boolean;
    valueRequired?: boolean;
    choices?: string[];
    default?: null | boolean | number | string | Array<boolean | number | string>;
    help?: string;
  }>;
  strategy?: string;
  example?: string;
  siteSession?: string;
};

export type DriverStatus = {
  state: "cold" | "starting" | "ready" | "needs-login" | "error";
  warmMode: "on-demand" | "bounded" | "always";
  warmUntil?: string;
  backupAvailable: boolean;
  lastCheckpointAt?: string;
  loginSite?: string;
  message?: string;
};

type DriverMetadata = {
  warmMode: "on-demand" | "bounded" | "always";
  warmUntil?: number;
  backup?: DirectoryBackup;
  lastCheckpointAt?: number;
  loginSite?: string;
  state: DriverStatus["state"];
  message?: string;
};

type OpenCliLogFields = {
  vendorId: string;
  accountId?: string;
  operation?: string;
  command?: string;
  error?: unknown;
};

const logger = createLogger<OpenCliLogFields>({
  component: "gatekeeper.opencli.driver",
  vendorId: "opencli",
});

const META_KEY = "metadata";
const PROFILE_DIR = "/workspace/opencli";
const RESTORED_MARKER = `${PROFILE_DIR}/.restored`;
const MAX_OUTPUT_BYTES = 2_000_000;

export class OpenCliDriver extends DurableObject<OpenCliEnv> {
  #metadata(): DriverMetadata {
    return this.ctx.storage.kv.get<DriverMetadata>(META_KEY) ?? {
      warmMode: "on-demand",
      state: "cold",
    };
  }

  #save(metadata: DriverMetadata): void {
    this.ctx.storage.kv.put(META_KEY, metadata);
  }

  #sandbox() {
    return getSandbox(this.env.Sandbox, sandboxIdForDurableObject(this.ctx.id.toString()), {
      sleepAfter: "10m",
      enableDefaultSession: false,
      normalizeId: true,
    });
  }

  async listCommands(): Promise<CommandDescriptor[]> {
    const result = await this.#sandbox().exec("opencli list -f json", { timeout: 60_000 });
    if (!result.success) throw new Error(`OpenCLI catalog failed: ${result.stderr.slice(0, 500)}`);
    const value = JSON.parse(result.stdout) as unknown;
    if (!Array.isArray(value)) throw new Error("OpenCLI returned an invalid command catalog.");
    return value.filter(isCommandDescriptor);
  }

  async getCommand(command: string): Promise<CommandDescriptor> {
    if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(command)) {
      throw new Error("Invalid OpenCLI command name.");
    }
    const found = (await this.listCommands()).find(item => item.command === command);
    if (!found) throw new Error(`OpenCLI command ${command} is not registered.`);
    return found;
  }

  async searchCommands(
    query: string,
    options: { site?: string; access?: "read" | "write"; limit?: number } = {},
  ): Promise<CommandDescriptor[]> {
    const normalized = query.trim().toLowerCase();
    const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 20), 50));
    return (await this.listCommands())
      .filter(command => !options.site || command.site === options.site)
      .filter(command => !options.access || command.access === options.access)
      .filter(command => !normalized ||
        command.command.toLowerCase().includes(normalized) ||
        command.description.toLowerCase().includes(normalized))
      .slice(0, limit);
  }

  async run(commandName: string, argv: string[]): Promise<string> {
    const descriptor = await this.getCommand(commandName);
    if (argv.length > 100 || argv.some(arg => typeof arg !== "string" || arg.length > 20_000)) {
      throw new Error("OpenCLI argv exceeds the command limits.");
    }
    await this.#ensureBrowser();
    const command = ["opencli", descriptor.site, descriptor.name, ...argv, "-f", "json"]
      .map(shellQuote)
      .join(" ");
    const result = await this.#sandbox().exec(
      `OPENCLI_CDP_ENDPOINT=http://127.0.0.1:9222 ${command}`,
      { timeout: 120_000 },
    );
    if (result.stdout.length + result.stderr.length > MAX_OUTPUT_BYTES) {
      throw new Error("OpenCLI output exceeded 2 MB.");
    }
    const metadata = this.#metadata();
    if (!result.success) {
      const message = result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`;
      if (/login|auth|unauthorized|forbidden/i.test(message)) {
        metadata.state = "needs-login";
        metadata.loginSite = descriptor.site;
        metadata.message = message.slice(0, 500);
        this.#save(metadata);
      }
      await this.#checkpointIfOnDemand();
      throw new Error(`OpenCLI ${commandName} failed: ${message.slice(0, 1000)}`);
    }
    metadata.state = "ready";
    metadata.message = undefined;
    this.#save(metadata);
    const output = result.stdout.trim();
    await this.#checkpointIfOnDemand();
    return output;
  }

  async beginLogin(site: string): Promise<{ url: string }> {
    const commands = (await this.listCommands()).filter(command => command.site === site);
    const domain = commands.find(command => command.domain)?.domain;
    if (!domain) throw new Error(`OpenCLI site ${site} does not declare a login domain.`);
    const metadata = this.#metadata();
    metadata.state = "starting";
    metadata.loginSite = site;
    metadata.message = undefined;
    this.#save(metadata);
    await this.#ensureBrowser();
    const open = await this.#sandbox().exec(
      `OPENCLI_CDP_ENDPOINT=http://127.0.0.1:9222 opencli browser cloudflare-os open ${shellQuote(`https://${domain}`)}`,
      { timeout: 60_000 },
    );
    if (!open.success) throw new Error(`Unable to open ${domain}: ${open.stderr.slice(0, 500)}`);
    const tunnel = await this.#sandbox().tunnels.get(6080);
    metadata.state = "needs-login";
    this.#save(metadata);
    const url = new URL("vnc.html", tunnel.url.endsWith("/") ? tunnel.url : `${tunnel.url}/`);
    url.searchParams.set("autoconnect", "true");
    url.searchParams.set("resize", "scale");
    return { url: url.toString() };
  }

  async finishLogin(): Promise<void> {
    const metadata = this.#metadata();
    metadata.state = "ready";
    metadata.message = undefined;
    this.#save(metadata);
    await this.checkpoint();
    await this.#sandbox().tunnels.destroy(6080).catch(() => {});
    if (metadata.warmMode !== "on-demand") await this.#ensureBrowser();
  }

  async setWarm(mode: "on-demand" | "bounded" | "always", minutes?: number): Promise<void> {
    const metadata = this.#metadata();
    metadata.warmMode = mode;
    if (mode === "bounded") {
      const bounded = Math.floor(minutes ?? 0);
      if (bounded < 1 || bounded > 1440) throw new Error("Warm duration must be 1 to 1440 minutes.");
      metadata.warmUntil = Date.now() + bounded * 60_000;
    } else {
      metadata.warmUntil = undefined;
    }
    this.#save(metadata);
    if (mode === "on-demand") {
      await this.ctx.storage.deleteAlarm();
      await this.#sandbox().setKeepAlive(false);
      await this.checkpoint();
      return;
    }
    await this.#ensureBrowser();
    await this.#sandbox().setKeepAlive(true);
    if (metadata.warmUntil) await this.ctx.storage.setAlarm(metadata.warmUntil);
    else await this.ctx.storage.deleteAlarm();
  }

  async status(): Promise<DriverStatus> {
    const metadata = this.#metadata();
    return {
      state: metadata.state,
      warmMode: metadata.warmMode,
      ...(metadata.warmUntil ? { warmUntil: new Date(metadata.warmUntil).toISOString() } : {}),
      backupAvailable: Boolean(metadata.backup),
      ...(metadata.lastCheckpointAt ? {
        lastCheckpointAt: new Date(metadata.lastCheckpointAt).toISOString(),
      } : {}),
      ...(metadata.loginSite ? { loginSite: metadata.loginSite } : {}),
      ...(metadata.message ? { message: metadata.message } : {}),
    };
  }

  async checkpoint(): Promise<void> {
    const sandbox = this.#sandbox();
    await this.#ensureBrowser();
    await sandbox.exec("opencli-session stop", { timeout: 30_000 });
    const metadata = this.#metadata();
    const previousBackup = metadata.backup;
    const backup = await sandbox.createBackup({
      dir: PROFILE_DIR,
      name: `opencli-${this.ctx.id.toString()}`,
      ttl: 31_536_000,
      ...(this.env.OPENCLI_LOCAL_BACKUPS === "true" ? { localBucket: true } : {}),
    });
    metadata.backup = backup;
    metadata.lastCheckpointAt = Date.now();
    metadata.state = "cold";
    this.#save(metadata);
    if (previousBackup && previousBackup.id !== backup.id) {
      await this.env.BACKUP_BUCKET.delete([
        `backups/${previousBackup.id}/data.sqsh`,
        `backups/${previousBackup.id}/meta.json`,
      ]).catch(error => logger.warn("old OpenCLI backup cleanup failed", {
        event: "backup.cleanup.failed",
        accountId: this.ctx.id.toString(),
        error,
      }));
    }
  }

  async alarm(): Promise<void> {
    const metadata = this.#metadata();
    if (metadata.warmMode === "on-demand" ||
        (metadata.warmMode === "bounded" && (!metadata.warmUntil || metadata.warmUntil <= Date.now()))) {
      metadata.warmMode = "on-demand";
      metadata.warmUntil = undefined;
      this.#save(metadata);
      await this.#sandbox().setKeepAlive(false);
      await this.checkpoint();
      return;
    }
    await this.#ensureBrowser();
    await this.#sandbox().setKeepAlive(true);
  }

  async revoke(): Promise<void> {
    const backup = this.#metadata().backup;
    await this.ctx.storage.deleteAlarm();
    await this.#sandbox().destroy();
    if (backup) await this.env.BACKUP_BUCKET.delete([
      `backups/${backup.id}/data.sqsh`,
      `backups/${backup.id}/meta.json`,
    ]);
    await this.ctx.storage.deleteAll();
  }

  async #ensureBrowser(): Promise<void> {
    const sandbox = this.#sandbox();
    const marker = await sandbox.exec(`test -f ${shellQuote(RESTORED_MARKER)}`, { timeout: 10_000 });
    const metadata = this.#metadata();
    if (!marker.success) {
      if (metadata.backup) await sandbox.restoreBackup(metadata.backup);
      await sandbox.exec(`mkdir -p ${shellQuote(PROFILE_DIR)} && touch ${shellQuote(RESTORED_MARKER)}`, {
        timeout: 30_000,
      });
    }
    const started = await sandbox.exec("opencli-session start", { timeout: 60_000 });
    if (!started.success) throw new Error(`OpenCLI browser failed to start: ${started.stderr.slice(0, 500)}`);
    metadata.state = "ready";
    this.#save(metadata);
  }

  async #checkpointIfOnDemand(): Promise<void> {
    if (this.#metadata().warmMode === "on-demand") await this.checkpoint();
  }
}
