# OpenCLI gatekeeper

An auto-provisioned Cloudflare OS singleton that runs registered OpenCLI commands in one private Cloudflare Sandbox per account. The management UI is touch-friendly and opens a temporary noVNC browser for normal website login.

## Session persistence

Chrome uses `/workspace/opencli/profile`. Before an on-demand sandbox sleeps, the driver stops Chrome and checkpoints `/workspace/opencli` to R2 with the Sandbox backup API. That snapshot includes cookies, IndexedDB, local storage, service-worker state, and the rest of the Chromium profile. A cold sandbox restores the snapshot before Chrome starts. Revoke deletes the sandbox and its latest backup.

Session modes are:

- **On demand:** checkpoint after each command and sleep.
- **Keep warm 1 hour:** use the Sandbox SDK's automatic keep-alive heartbeat until a Durable Object alarm checkpoints and sleeps it.
- **Always warm:** keep the Sandbox alive until the user changes mode or revokes the account. This continuously consumes container capacity.

## Deployment boundary

This package is `direct-only` for now. Release manifest v2 distributes Worker modules but has no cross-account container-image artifact contract, so the release builder intentionally excludes it instead of shipping a broken install. A direct deploy must provide the account ID and backup bucket name as vars, create `BACKUP_BUCKET`, and set R2 object read/write credentials as the `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` secrets.

The R2 bucket should have a lifecycle rule for `backups/`. The driver deletes the superseded checkpoint, while the lifecycle rule covers interrupted uploads.

## Verify

```sh
pnpm --filter @gadgets/gatekeeper-opencli test
pnpm --filter @gadgets/gatekeeper-opencli run types:check
pnpm --filter @gadgets/gatekeeper-opencli exec wrangler deploy --dry-run
```
