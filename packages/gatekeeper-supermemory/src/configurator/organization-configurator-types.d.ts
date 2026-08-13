export type SupermemoryOrganizationConfiguratorValues = Record<string, never>;

export interface SupermemoryOrganizationConfiguratorRpc {
  getLabel(): Promise<string>;
}
