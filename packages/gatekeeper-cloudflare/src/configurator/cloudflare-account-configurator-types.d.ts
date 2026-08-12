export type ConfiguratorOption = {
  value: string;
  title: string;
  subtitle?: string;
  meta?: string;
};

export type CloudflareAccountConfiguratorValues = {
  accountId?: string | null;
};

export interface CloudflareAccountConfiguratorRpc {
  listAccounts(query: string): Promise<ConfiguratorOption[]>;
}
