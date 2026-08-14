/** The registered OpenCLI command catalog and this account's browser-backed sessions. */
export interface OpenCLI {
  /** Searches registered site adapters by command, site, or description. */
  searchCommands(query: string, options?: { site?: string; access?: "read" | "write"; limit?: number }): Promise<OpenCliCommandSummary[]>;
  /** Returns a capability for one exact registered command such as github/repos. */
  getCommand(command: string): Promise<OpenCliCommand>;
  /** Reports browser profile persistence and warm-session state. */
  connectionStatus(): Promise<OpenCliConnectionStatus>;
  /** Reads the state and output of a command execution. */
  getExecution(executionId: string): Promise<OpenCliExecution | null>;
}

/** One registered OpenCLI adapter command. */
export interface OpenCliCommand {
  /** Returns the command's arguments and read/write classification. */
  describe(): Promise<OpenCliCommandDetails>;
  /** Runs the registered command with argv tokens. Shell syntax is never accepted. */
  run(argv?: string[]): Promise<{ executionId: string }>;
}

export interface OpenCliCommandSummary {
  command: string;
  site: string;
  name: string;
  description: string;
  access: "read" | "write";
  browser: boolean;
  domain?: string;
}

export interface OpenCliArgument {
  name: string;
  type: string;
  required: boolean;
  positional: boolean;
  valueRequired?: boolean;
  choices?: string[];
  default?: unknown;
  help?: string;
}

export interface OpenCliCommandDetails extends OpenCliCommandSummary {
  args: OpenCliArgument[];
  strategy?: string;
  example?: string;
  siteSession?: string;
}

export interface OpenCliConnectionStatus {
  state: "cold" | "starting" | "ready" | "needs-login" | "error";
  warmMode: "on-demand" | "bounded" | "always";
  warmUntil?: string;
  backupAvailable: boolean;
  lastCheckpointAt?: string;
  loginSite?: string;
  message?: string;
}

export interface OpenCliExecution {
  id: string;
  command: string;
  access: "read" | "write";
  state: "pending" | "applied" | "rejected" | "failed";
  submittedAt: string;
  completedAt?: string;
  output?: unknown;
  error?: string;
}
