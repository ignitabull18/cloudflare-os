import type { GatekeeperAppInfo } from '@gadgets/workshop-shared/api'

/** Removes catalog rows for vendors already represented by a connected account. */
export function excludeConnectedGatekeeperVendors<T extends { id: string }>(
  vendors: T[],
  accounts: Array<{ vendorId: string }>,
): T[] {
  const connectedVendorIds = new Set(accounts.map((account) => account.vendorId))
  return vendors.filter((vendor) => !connectedVendorIds.has(vendor.id))
}

/** Keeps management apps that opt into the product's primary navigation. */
export function primaryNavigationGatekeeperApps(
  apps: GatekeeperAppInfo[],
): GatekeeperAppInfo[] {
  return apps.filter((app) => app.showInNavigation)
}
