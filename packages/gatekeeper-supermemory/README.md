# Supermemory gatekeeper

This Worker connects a Supermemory organization to Cloudflare OS using an organization API key
entered through the in-app connection flow. The key remains in the account Durable Object.

It exposes two capability granularities:

- `SupermemoryContainer` limits an agent or Gadget to one `containerTag`. The container selected
  during connection is also the account's ambient singleton.
- `SupermemoryOrganization` is an explicit administrative binding for creating container-scoped
  keys and managing Supermemory source connectors.

## Development status

Phase 1 implements authentication, typed capabilities, resource configurators, API scoping, and
release registration. Do not deploy this gatekeeper until phase 2 adds approval-queued actions,
observation authorization, action simulation, caching where useful, and final observer hardening.

## Verification

```sh
pnpm --filter @gadgets/supermemory-gatekeeper test
pnpm --filter @gadgets/supermemory-gatekeeper build
pnpm --filter @gadgets/supermemory-gatekeeper exec wrangler deploy --dry-run
node --test scripts/release-manifest.test.js
```
