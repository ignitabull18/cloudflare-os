import { Composio as ComposioSdk, type Tool } from "@composio/core";
import { createLogger } from "@gadgets/backend-utils/logger";
import { boundToolLimit } from "./composio-utils.js";

type ComposioLogFields = {
  vendorId: string;
  operation?: string;
  toolkit?: string;
  toolSlug?: string;
  connectionId?: string;
  error?: unknown;
};

const logger = createLogger<ComposioLogFields>({
  component: "gatekeeper.composio.api",
  vendorId: "composio",
});

export type ToolkitCard = {
  slug: string;
  name: string;
  description?: string;
  logo?: string;
  toolsCount?: number;
  connectedAccount?: {
    id: string;
    alias?: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
};

export type ConnectionInfo = NonNullable<ToolkitCard["connectedAccount"]> & { toolkit: string };

export class ComposioApi {
  readonly #sdk: ComposioSdk;

  constructor(apiKey: string, readonly userId: string) {
    if (!apiKey) throw new Error("COMPOSIO_API_KEY is not configured.");
    this.#sdk = new ComposioSdk({ apiKey, allowTracking: false });
  }

  async searchTools(query: string, toolkit?: string, limit = 20): Promise<Tool[]> {
    const bounded = boundToolLimit(limit);
    if (toolkit) {
      const tools = await this.#sdk.tools.getRawComposioTools({
        toolkits: [toolkit],
        search: query.trim() || undefined,
        limit: bounded,
      });
      return tools.slice(0, bounded);
    }
    if (!query.trim()) throw new Error("A search query or toolkit is required.");
    const tools = await this.#sdk.tools.getRawComposioTools({ search: query.trim() });
    return tools.slice(0, bounded);
  }

  async getTool(slug: string): Promise<Tool> {
    return this.#sdk.tools.getRawComposioToolBySlug(slug, { version: "latest" });
  }

  async execute(toolSlug: string, version: string | undefined, args: Record<string, unknown>) {
    logger.info("executing composio tool", { event: "tool.execute", toolSlug });
    return this.#sdk.tools.execute(toolSlug, {
      userId: this.userId,
      arguments: args,
      ...(version ? { version } : { dangerouslySkipVersionCheck: true }),
    });
  }

  async listConnections(): Promise<ConnectionInfo[]> {
    const page = await this.#sdk.connectedAccounts.list({ userIds: [this.userId], limit: 1000 });
    return page.items.map(item => ({
      id: item.id,
      toolkit: item.toolkit.slug,
      ...(item.alias ? { alias: item.alias } : {}),
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
  }

  async listToolkits(search = ""): Promise<ToolkitCard[]> {
    const [toolkits, connections] = await Promise.all([
      this.#sdk.toolkits.get({ limit: 1000, sortBy: "usage" }),
      this.listConnections(),
    ]);
    const connectionByToolkit = new Map(
      connections.map(connection => [connection.toolkit, connection]),
    );
    const normalizedSearch = search.trim().toLowerCase();
    return toolkits
      .filter(toolkit => !normalizedSearch ||
        toolkit.name.toLowerCase().includes(normalizedSearch) ||
        toolkit.slug.toLowerCase().includes(normalizedSearch) ||
        toolkit.meta.description?.toLowerCase().includes(normalizedSearch))
      .map(toolkit => {
        const connection = connectionByToolkit.get(toolkit.slug);
        return {
          slug: toolkit.slug,
          name: toolkit.name,
          ...(toolkit.meta.description ? { description: toolkit.meta.description } : {}),
          ...(toolkit.meta.logo ? { logo: toolkit.meta.logo } : {}),
          ...(toolkit.meta.toolsCount === undefined ? {} : { toolsCount: toolkit.meta.toolsCount }),
          ...(connection ? { connectedAccount: connection } : {}),
        };
      })
      .toSorted((left, right) =>
        Number(Boolean(right.connectedAccount)) - Number(Boolean(left.connectedAccount)) ||
        left.name.localeCompare(right.name));
  }

  async authorize(toolkit: string): Promise<string> {
    logger.info("creating composio connect link", { event: "connection.link.created", toolkit });
    const request = await this.#sdk.toolkits.authorize(this.userId, toolkit);
    if (!request.redirectUrl) throw new Error(`Composio did not return a connect link for ${toolkit}.`);
    return request.redirectUrl;
  }

  async deleteConnection(connectionId: string): Promise<void> {
    logger.info("deleting composio connection", {
      event: "connection.deleted",
      connectionId,
    });
    await this.#sdk.connectedAccounts.delete(connectionId);
  }

  async revokeAll(): Promise<void> {
    for (const connection of await this.listConnections()) {
      try {
        await this.deleteConnection(connection.id);
      } catch (error) {
        logger.warn("failed to delete composio connection during revoke", {
          event: "connection.delete.failed",
          connectionId: connection.id,
          error,
        });
      }
    }
  }
}
