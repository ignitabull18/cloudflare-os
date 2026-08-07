import { DurableObject } from "cloudflare:workers";
import type { AiChatAuthorInfo, AiModelConfig } from "@gadgets/workshop-shared/api";
import type { UserAiModelRecord } from "./user.js";

const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth";
const REFRESH_SKEW_MS = 5 * 60 * 1000;

type StoredCodexCredentials = {
  accessToken: string;
  refreshToken: string;
  accountId: string;
  expiresAt: number;
};

type RefreshResponse = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
};

type JwtClaims = {
  exp?: number;
  chatgpt_account_id?: string;
  [OPENAI_AUTH_CLAIM]?: { chatgpt_account_id?: string };
};

/** Stable profile id for the deployment-owned Codex subscription model. */
export const CODEX_SUBSCRIPTION_PROFILE_ID = "codex-subscription:gpt-5.6-sol";

/** Returns true when this deployment has been seeded with a Codex OAuth refresh token. */
export function isCodexSubscriptionConfigured(env: Cloudflare.Env): boolean {
  return Boolean(
      env.CODEX_OAUTH_REFRESH_TOKEN && env.CODEX_EGRESS_URL && env.CODEX_EGRESS_TOKEN,
  );
}

/** Builds the model record exposed to users when Codex subscription auth is configured. */
export function codexSubscriptionModel(): UserAiModelRecord {
  const profile: AiChatAuthorInfo = {
    type: "agent",
    id: CODEX_SUBSCRIPTION_PROFILE_ID,
    name: "GPT 5.6 Sol (Codex subscription)",
  };
  const config: AiModelConfig = {
    provider: "openai",
    model: "gpt-5.6-sol",
    apiToken: "",
    apiUrl: "https://chatgpt.com/backend-api/codex",
    authentication: "codex-subscription",
  };
  return { profile, config };
}

function decodeJwtClaims(token: string): JwtClaims {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Codex OAuth returned a malformed access token.");

  const padded = payload.replace(/-/g, "+").replace(/_/g, "/")
      .padEnd(Math.ceil(payload.length / 4) * 4, "=");
  try {
    return JSON.parse(atob(padded)) as JwtClaims;
  } catch {
    throw new Error("Codex OAuth returned an unreadable access token.");
  }
}

function accountIdFromTokens(accessToken: string, idToken?: string): string | undefined {
  for (const token of [idToken, accessToken]) {
    if (!token) continue;
    const claims = decodeJwtClaims(token);
    const accountId = claims.chatgpt_account_id ??
        claims[OPENAI_AUTH_CLAIM]?.chatgpt_account_id;
    if (accountId) return accountId;
  }
  return undefined;
}

/**
 * Deployment-private credential broker for Codex subscription inference. The Workshop reaches this
 * Durable Object through an internal binding; it owns refresh-token rotation and forwards only the
 * Responses endpoint, so OAuth credentials never enter model configs or browser RPC traffic.
 */
export class CodexTokenBroker extends DurableObject<Cloudflare.Env> {
  #refreshing?: Promise<StoredCodexCredentials>;

  async #refreshCredentials(current?: StoredCodexCredentials): Promise<StoredCodexCredentials> {
    const refreshToken = current?.refreshToken ?? this.env.CODEX_OAUTH_REFRESH_TOKEN;
    if (!refreshToken) {
      throw new Error("Codex subscription authentication is not configured.");
    }

    const response = await fetch(CODEX_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CODEX_OAUTH_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    if (!response.ok) {
      throw new Error(`Codex OAuth token refresh failed with status ${response.status}.`);
    }

    const refreshed = await response.json<RefreshResponse>();
    if (!refreshed.access_token) {
      throw new Error("Codex OAuth token refresh returned no access token.");
    }

    const claims = decodeJwtClaims(refreshed.access_token);
    const accountId = accountIdFromTokens(refreshed.access_token, refreshed.id_token) ??
        current?.accountId;
    if (!accountId || !claims.exp) {
      throw new Error("Codex OAuth token refresh returned incomplete account credentials.");
    }

    const credentials: StoredCodexCredentials = {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? refreshToken,
      accountId,
      expiresAt: claims.exp * 1000,
    };
    this.ctx.storage.kv.put("credentials", credentials);
    return credentials;
  }

  async #getCredentials(): Promise<StoredCodexCredentials> {
    const current = this.ctx.storage.kv.get<StoredCodexCredentials>("credentials");
    if (current && current.expiresAt > Date.now() + REFRESH_SKEW_MS) return current;

    this.#refreshing ??= this.#refreshCredentials(current);
    try {
      return await this.#refreshing;
    } finally {
      this.#refreshing = undefined;
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.href !== CODEX_RESPONSES_URL) {
      return new Response("Not Found", { status: 404 });
    }

    const credentials = await this.#getCredentials();
    const egressUrl = new URL(this.env.CODEX_EGRESS_URL ?? "");
    if (egressUrl.protocol !== "https:" || egressUrl.username || egressUrl.password) {
      throw new Error("Codex egress must be an HTTPS URL without embedded credentials.");
    }
    if (!this.env.CODEX_EGRESS_TOKEN) {
      throw new Error("Codex egress authentication is not configured.");
    }
    const headers = new Headers({
      "Accept": request.headers.get("Accept") ?? "text/event-stream",
      "Authorization": `Bearer ${this.env.CODEX_EGRESS_TOKEN}`,
      "Content-Type": "application/json",
      "X-Codex-Access-Token": credentials.accessToken,
      "X-Codex-Account-ID": credentials.accountId,
    });
    for (const name of ["Content-Encoding", "Session-Id", "X-Client-Request-Id"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    const response = await fetch(egressUrl, {
      method: "POST",
      headers,
      body: request.body,
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) {
      return new Response("Codex upstream redirect blocked.", { status: 502 });
    }
    return response;
  }
}
