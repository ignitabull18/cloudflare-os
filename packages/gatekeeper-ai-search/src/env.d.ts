declare namespace Cloudflare {
  interface Env {
    AI_SEARCH: AiSearchNamespace;
  }

  interface GlobalProps {
    mainModule: typeof import("./index.js");
    durableNamespaces: "AiSearchGatekeeper";
  }
}
