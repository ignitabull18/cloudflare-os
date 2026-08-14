import { describe, expect, it } from 'vitest'
import type { GatekeeperAppInfo } from '@gadgets/workshop-shared/api'
import {
  excludeConnectedGatekeeperVendors,
  primaryNavigationGatekeeperApps,
} from './gatekeeperPresentation'

describe('gatekeeper presentation', () => {
  it('does not repeat connected vendors in the available catalog', () => {
    const vendors = [{ id: 'cloudflare' }, { id: 'slack' }, { id: 'notion' }]
    const accounts = [{ vendorId: 'cloudflare' }, { vendorId: 'notion' }]

    expect(excludeConnectedGatekeeperVendors(vendors, accounts)).toEqual([
      { id: 'slack' },
    ])
  })

  it('keeps management apps out of primary navigation when they opt out', () => {
    const apps: GatekeeperAppInfo[] = [
      { id: 'context', title: 'Context & Skills', showInNavigation: true },
      { id: 'opencli', title: 'OpenCLI', showInNavigation: false },
      { id: 'composio', title: 'Composio', showInNavigation: false },
    ]

    expect(primaryNavigationGatekeeperApps(apps)).toEqual([
      { id: 'context', title: 'Context & Skills', showInNavigation: true },
    ])
  })
})
