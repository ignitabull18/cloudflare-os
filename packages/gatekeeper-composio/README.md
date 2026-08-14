# Composio gatekeeper

An auto-provisioned Cloudflare OS singleton backed by one stable Composio user per gatekeeper account. It provides tool discovery and execution to agents, plus a touch-friendly management UI for connecting and disconnecting app accounts.

All tool executions enter the Workshop approval queue. Catalog, schema, connection, and execution-status reads use observation authorization. Composio owns OAuth tokens and refresh; this Worker stores only the account ID and execution audit records.

## Deploy input

The install wizard requires `COMPOSIO_API_KEY`, a Composio project API key. The gatekeeper is install-once because it contributes one ambient `COMPOSIO` singleton.

## Verify

```sh
pnpm --filter @gadgets/gatekeeper-composio test
pnpm --filter @gadgets/gatekeeper-composio run types:check
```
