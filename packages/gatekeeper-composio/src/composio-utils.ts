export function boundToolLimit(limit: number): number {
  return Math.max(1, Math.min(Math.floor(limit), 50));
}

export function stableComposioUserId(accountId: string): string {
  return `cloudflare-os:${accountId}`;
}
