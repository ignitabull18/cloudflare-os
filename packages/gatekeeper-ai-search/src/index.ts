export {
  AiSearchAccount,
  AiSearchGatekeeper,
  AiSearchManagementApi,
  AiSearchSession,
  AiSearchVerifier,
  GatekeeperVendor,
} from "./search.js";
export type {
  AiSearchLibrary,
  LibrarySummary,
  ManagedSearchItem,
  SearchAnswer,
  SearchMatch,
  SearchOptions,
} from "./types.js";

// Keep ES Module worker format; this worker is reached through RPC and Durable Objects.
export default {
  async fetch(): Promise<Response> {
    return new Response("AI Search gatekeeper is running.", {
      headers: { "content-type": "text/plain" },
    });
  },
};
