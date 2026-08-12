/** Basic information about the connected Cloudflare account. */
export interface CloudflareAccountMetadata {
  /** Stable Cloudflare account ID. */
  id: string;
  /** Account name shown in the Cloudflare dashboard. */
  name: string;
  /** Cloudflare account plan category. */
  type: "standard" | "enterprise";
  /** When the account was created, as an RFC 3339 timestamp when available. */
  createdOn?: string;
}

/** Summary of a Worker deployed in the account. */
export interface CloudflareWorkerSummary {
  /** Worker script name. */
  name: string;
  /** When the Worker was created, as an RFC 3339 timestamp when available. */
  createdOn?: string;
  /** When the Worker was last modified, as an RFC 3339 timestamp when available. */
  modifiedOn?: string;
}

/** Summary of an AI Gateway in the account. */
export interface CloudflareAiGatewaySummary {
  /** Gateway ID used in AI Gateway request URLs. */
  id: string;
  /** When the gateway was created, as an RFC 3339 timestamp when available. */
  createdOn?: string;
  /** When the gateway was last modified, as an RFC 3339 timestamp when available. */
  modifiedOn?: string;
}

/** Summary of an R2 bucket in the account. */
export interface CloudflareR2BucketSummary {
  /** Bucket name. */
  name: string;
  /** Bucket jurisdiction when Cloudflare reports one. */
  jurisdiction?: string;
  /** Bucket location hint when Cloudflare reports one. */
  location?: string;
  /** When the bucket was created, as an RFC 3339 timestamp when available. */
  createdOn?: string;
}

/** Summary of a Workers KV namespace in the account. */
export interface CloudflareKvNamespaceSummary {
  /** Stable namespace ID. */
  id: string;
  /** Namespace title. */
  title: string;
}

/** Read-only access to one Cloudflare account and its developer-platform inventory. */
export interface CloudflareAccount {
  /** Returns basic information about this account. */
  getMetadata(): Promise<CloudflareAccountMetadata>;
  /** Lists the Workers deployed in this account. */
  listWorkers(): Promise<CloudflareWorkerSummary[]>;
  /** Lists the AI Gateways configured in this account. */
  listAiGateways(): Promise<CloudflareAiGatewaySummary[]>;
  /** Lists the R2 buckets in this account. */
  listR2Buckets(): Promise<CloudflareR2BucketSummary[]>;
  /** Lists the Workers KV namespaces in this account. */
  listKvNamespaces(): Promise<CloudflareKvNamespaceSummary[]>;
}
