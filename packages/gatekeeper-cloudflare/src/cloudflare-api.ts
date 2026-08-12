// Thin client over the Cloudflare REST API used by the gatekeeper: resolve the account's identity
// (email) and enumerate accounts. All calls use the user's OAuth access token.

import { VENDOR_ID } from "./vendor.js";
import { obsContext } from "./observability.js";

const API_BASE = "https://api.cloudflare.com/client/v4";

const logger = obsContext.createLogger({
  component: "gatekeeper.cloudflare", vendorId: VENDOR_ID,
});

interface CfEnvelope<T> {
  success: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
}

export class CloudflareApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

async function cfGet<T>(token: string, path: string): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
  });
  if (!resp.ok) {
    logger.error("cf-gatekeeper GET failed", {
      event: "cloudflare.api.get.failed",
      path, status: resp.status, statusText: resp.statusText,
    });
    resp.body?.cancel();
    throw new CloudflareApiError(`Cloudflare API request failed with status ${resp.status}.`, resp.status);
  }
  const data = await resp.json() as CfEnvelope<T>;
  if (!data.success || data.result === undefined) {
    const message = data.errors?.map(error => error.message).filter(Boolean).join("; ") ||
      "Cloudflare API returned an unsuccessful response.";
    throw new CloudflareApiError(message, resp.status);
  }
  return data.result;
}

export interface CloudflareIdentity {
  // Cloudflare user id (stable).
  id: string;
  // Account email — verified by Cloudflare, so safe to use as a sign-in identity.
  email: string;
  displayName: string;
}

// Resolve the connected user's identity via the /user API (requires `user-details.read`). We use
// this rather than an OIDC userinfo endpoint because the dashboard OAuth client isn't permitted the
// `openid` scope. Returns null if the email is missing.
export async function fetchIdentity(token: string): Promise<CloudflareIdentity | null> {
  let r: { id?: string; email?: string; first_name?: string; last_name?: string };
  try {
    r = await cfGet(token, "/user");
  } catch {
    return null;
  }
  if (!r.id || !r.email) return null;
  const name = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
  return {
    id: String(r.id),
    email: r.email,
    displayName: name || r.email.split("@")[0],
  };
}

export interface CloudflareAccount {
  accountId: string;
  accountName: string;
}

// List the accounts the token can access. Requires `account-settings.read`.
export async function listAccounts(token: string): Promise<CloudflareAccount[]> {
  const result = await cfGet<Array<{ id: string; name: string }>>(token, "/accounts");
  return result.map((a) => ({ accountId: a.id, accountName: a.name }));
}

export interface CloudflareAccountDetails {
  id: string;
  name: string;
  type: "standard" | "enterprise";
  createdOn?: string;
}

export interface CloudflareWorker {
  name: string;
  createdOn?: string;
  modifiedOn?: string;
}

export interface CloudflareAiGateway {
  id: string;
  createdOn?: string;
  modifiedOn?: string;
}

export interface CloudflareR2Bucket {
  name: string;
  jurisdiction?: string;
  location?: string;
  createdOn?: string;
}

export interface CloudflareKvNamespace {
  id: string;
  title: string;
}

const encode = encodeURIComponent;

export class CloudflareApi {
  constructor(private readonly getToken: () => Promise<string>) {}

  async getAccount(accountId: string): Promise<CloudflareAccountDetails> {
    const token = await this.getToken();
    const account = await cfGet<{
      id: string; name: string; type: "standard" | "enterprise"; created_on?: string;
    }>(token, `/accounts/${encode(accountId)}`);
    return { id: account.id, name: account.name, type: account.type, createdOn: account.created_on };
  }

  async listWorkers(accountId: string): Promise<CloudflareWorker[]> {
    const token = await this.getToken();
    const workers = await cfGet<Array<{ id: string; created_on?: string; modified_on?: string }>>(
      token, `/accounts/${encode(accountId)}/workers/scripts`,
    );
    return workers.slice(0, 1000).map(worker => ({
      name: worker.id,
      createdOn: worker.created_on,
      modifiedOn: worker.modified_on,
    }));
  }

  async listAiGateways(accountId: string): Promise<CloudflareAiGateway[]> {
    const token = await this.getToken();
    const gateways = await cfGet<Array<{ id: string; created_at?: string; modified_at?: string }>>(
      token, `/accounts/${encode(accountId)}/ai-gateway/gateways?per_page=100`,
    );
    return gateways.map(gateway => ({
      id: gateway.id,
      createdOn: gateway.created_at,
      modifiedOn: gateway.modified_at,
    }));
  }

  async listR2Buckets(accountId: string): Promise<CloudflareR2Bucket[]> {
    const token = await this.getToken();
    const result = await cfGet<{ buckets: Array<{
      name: string; jurisdiction?: string; location?: string; creation_date?: string;
    }> }>(token, `/accounts/${encode(accountId)}/r2/buckets?per_page=1000`);
    return result.buckets.map(bucket => ({
      name: bucket.name,
      jurisdiction: bucket.jurisdiction,
      location: bucket.location,
      createdOn: bucket.creation_date,
    }));
  }

  async listKvNamespaces(accountId: string): Promise<CloudflareKvNamespace[]> {
    const token = await this.getToken();
    const namespaces = await cfGet<Array<{ id: string; title: string }>>(
      token, `/accounts/${encode(accountId)}/storage/kv/namespaces?per_page=1000`,
    );
    return namespaces.map(namespace => ({ id: namespace.id, title: namespace.title }));
  }
}
