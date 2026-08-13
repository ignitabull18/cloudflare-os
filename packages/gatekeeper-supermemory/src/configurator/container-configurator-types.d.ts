export type SupermemoryContainerOption = {
  value: string;
  title: string;
  subtitle?: string;
};

export type SupermemoryContainerConfiguratorValues = {
  containerTag?: string | null;
};

export interface SupermemoryContainerConfiguratorRpc {
  listContainers(query: string): Promise<SupermemoryContainerOption[]>;
}
