# Gatekeeper AI Search

An auto-provisioned Cloudflare AI Search capability for Cloudflare OS. Each connected account owns
one private AI Search instance in the deployment's `default` namespace. The account exposes:

- an ambient `AiSearchLibrary` singleton with observation-authorized `search()` and `answer()`;
- bounded document discovery through the agent catalog;
- a management page for upload, reindex, and deletion;
- a verifier that prevents shared workspaces from revealing the private index to another account.

The gatekeeper uses the native `AI_SEARCH` namespace binding. It never receives an API token.

## Local development

AI Search has no local simulator. Start the full development stack with the explicit remote-binding
flag while authenticated to Cloudflare:

```sh
pnpm dev-server -- --use-ai-search-binding
```

Ordinary `pnpm dev-server` excludes this package so offline development continues to work.

## Verification

```sh
pnpm --filter @gadgets/gatekeeper-ai-search test
pnpm --filter @gadgets/gatekeeper-ai-search types:check
pnpm --filter @gadgets/gatekeeper-ai-search exec wrangler deploy --dry-run
```
