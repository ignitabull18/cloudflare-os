# Supermemory gatekeeper

This Worker connects a Supermemory organization to Cloudflare OS using an organization API key
entered through the in-app connection flow. The key remains in the account Durable Object.

It exposes two capability granularities:

- `SupermemoryContainer` limits an agent or Gadget to one `containerTag`. The container selected
  during connection is also the account's ambient singleton.
- `SupermemoryOrganization` is an explicit administrative binding for creating container-scoped
  keys and managing Supermemory source connectors.

## Security model

Every external read is authorized as an observation. Writes are persisted in the gatekeeper's
Durable Object and submitted to the Workshop approval queue; the Supermemory API is called only
from `applyAction()`. Pending writes are overlaid on cached reads so agents can continue working
with provisional memories, documents, connectors, and scoped-key issuances. Bindings are
private-only because Supermemory API keys do not provide a reliable collaborator ACL oracle.

## Verification

```sh
pnpm --filter @gadgets/supermemory-gatekeeper test
pnpm --filter @gadgets/supermemory-gatekeeper build
pnpm --filter @gadgets/supermemory-gatekeeper exec wrangler deploy --dry-run
node --test scripts/release-manifest.test.js
```
