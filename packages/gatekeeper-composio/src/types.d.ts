/** A Composio tool catalog and the account connections available to this user. */
export interface Composio {
  /** Searches tool names and descriptions. Use a returned slug with getTool(). */
  searchTools(query: string, options?: { toolkit?: string; limit?: number }): Promise<ComposioToolSummary[]>;
  /** Returns a capability for inspecting and running one exact tool slug. */
  getTool(slug: string): Promise<ComposioTool>;
  /** Lists this user's connected apps and their current authentication state. */
  listConnections(): Promise<ComposioConnection[]>;
  /** Reads the current state and result of an execution created by ComposioTool.run(). */
  getExecution(executionId: string): Promise<ComposioExecution | null>;
}

/** One exact Composio tool. */
export interface ComposioTool {
  /** Returns the tool's current input schema and descriptive metadata. */
  describe(): Promise<ComposioToolDetails>;
  /** Requests execution with structured arguments and returns its stable execution ID. */
  run(input: Record<string, unknown>): Promise<{ executionId: string }>;
}

/** Bounded tool metadata returned by searchTools(). */
export interface ComposioToolSummary {
  slug: string;
  name: string;
  description?: string;
  toolkit?: { slug: string; name: string; logo?: string };
  version?: string;
}

/** Full metadata needed to construct a tool call. */
export interface ComposioToolDetails extends ComposioToolSummary {
  inputParameters?: Record<string, unknown>;
  outputParameters?: Record<string, unknown>;
  tags?: string[];
}

/** A provider account whose credentials are stored and refreshed by Composio. */
export interface ComposioConnection {
  id: string;
  toolkit: string;
  alias?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** Locally tracked lifecycle of one requested tool execution. */
export interface ComposioExecution {
  id: string;
  toolSlug: string;
  state: "pending" | "applied" | "rejected" | "failed";
  submittedAt: string;
  completedAt?: string;
  successful?: boolean;
  result?: Record<string, unknown>;
  error?: string;
  logId?: string;
}
