# Supermemory best practices for Cloudflare OS

Checked 2026-08-12 PT. Primary Supermemory sources only. “Official” sections report the product's documented behavior; “Recommendation” sections are Cloudflare OS design choices inferred from those facts.

## Answer

Give Cloudflare OS its own `containerTag`, treat that tag as a hard permission and knowledge boundary, and write two different things into it:

- **Memories** for concise facts already known to be durable enough to recall directly: preferences, naming rules, architectural decisions, and current project state.
- **Documents** for the source material agents may need to search: completed-task records, conversations, research reports, runbooks, deployment evidence, and connector content.

At session start, load the container profile. On each substantive request, use profile plus query-specific recall. At successful task completion, append one coherent, medium-sized task record under a stable `customId`. Correct old facts by versioned update or forgetting instead of adding contradictory duplicates. This follows Supermemory's own harness pattern: **session start → profile; on message → search; on stop → save conversation** ([Rules of Supermemory](https://supermemory.ai/docs/concepts/rules)).

Do not interpret “save everything” as storing secrets, raw tool exhaust, transactional records, or verbatim global instructions. Supermemory explicitly distinguishes remembered/looked-up knowledge from database records and system-prompt rules ([Rules of Supermemory](https://supermemory.ai/docs/concepts/rules)).

## 1. Isolation and identity

### Official facts

- A `containerTag` creates an isolated memory space and is intended for a user, project, workspace, or other logical boundary. Search is scoped to one tag ([Organizing and Filtering](https://supermemory.ai/docs/concepts/filtering)).
- Supermemory's production guidance is to use a container wherever there is a hard permission boundary, rather than combining tenants and relying on metadata alone ([Rules of Supermemory](https://supermemory.ai/docs/concepts/rules)).
- Each container gets its own automatically maintained profile; the profile entity can be a user, agent, organization, or another entity ([User Profiles](https://supermemory.ai/docs/concepts/user-profiles)).
- Scoped API keys are restricted to one container and can access documents, memories, search, and profile endpoints in that container; they support expiry and rate limits and can be revoked without affecting the container's memories ([Authentication](https://supermemory.ai/docs/authentication)).

### Recommendation for Cloudflare OS

- Use one dedicated tag: `ignitabull:cloudflare-os:activity`. Never reuse the existing general/personal-memory container. Colons satisfy the stricter container-tag character rules documented across current endpoints; dots are accepted by some Supermemory endpoints but not consistently documented.
- Set the container `entityContext` to identify the subject precisely: “Cloudflare OS operational memory for Ignitabull: decisions, workflows, agents, registries, deployments, verification evidence, and operator preferences. The entity is the Cloudflare OS system and its work, not the assistant.” Supermemory documents that entity context persists per container and helps prevent extraction drift ([Customizing for Your Use Case](https://supermemory.ai/docs/concepts/customization)).
- Bind Cloudflare OS agents and Gadgets with a scoped key for only this tag. Prefer 30–90 day expiry, the lowest practical rate limit, rotation, and immediate revocation on suspected exposure. Keep the organization key in the administrative Gatekeeper only.

## 2. Memories, documents, and static facts

### Official facts

- Documents are raw inputs; memories are extracted or directly created knowledge units. V4 direct memories bypass document ingestion and are immediately searchable, which Supermemory recommends when the exact fact is already known ([How Supermemory Works](https://supermemory.ai/docs/concepts/how-it-works), [Memory Operations](https://supermemory.ai/docs/recall/memory-operations)).
- A static memory is for a permanent identity trait. Static and dynamic profile sections distinguish long-lived facts from recent/changing context ([Memory Operations](https://supermemory.ai/docs/recall/memory-operations), [User Profiles](https://supermemory.ai/docs/concepts/user-profiles)).
- `taskType: "superrag"` skips fact extraction/profile updates when content is only for document search; it is documented as substantially cheaper. Hybrid search is recommended when a container has both document chunks and memories ([Ingesting Context](https://supermemory.ai/docs/ingestion/add-memories), [Rules of Supermemory](https://supermemory.ai/docs/concepts/rules)).

### Recommendation for Cloudflare OS

Use direct memories sparingly:

| Content | Store as | Static? |
| --- | --- | --- |
| Permanent namespace rule, owner identity, non-negotiable operator preference | Direct memory | Yes, only if genuinely stable |
| Architecture decision, workflow definition, deployment state, current priority | Direct memory plus source document link/ID | No |
| Task transcript, research report, runbook, changelog, test/deploy evidence | Document using full memory processing | No |
| Large reference corpus needed only for lookup | Document using `superrag` | No |
| Exact transactional state, secret, API key, raw database row | Do not ingest | N/A |
| Verbatim behavioral or security rule that must apply to every request | System instructions, not memory | N/A |

Keep task documents medium-sized and self-contained. Supermemory says excessively long documents yield fewer memories and relations, and recommends sequential ingestion within one container so temporal/update relations preserve order ([Rules of Supermemory](https://supermemory.ai/docs/concepts/rules)).

## 3. Metadata and profile structure

### Official facts

- Metadata is flat, case-sensitive, and filterable. Current ingestion docs specify string, number, and boolean values with no nested objects ([Ingesting Context](https://supermemory.ai/docs/ingestion/add-memories)).
- Metadata filters can narrow search, profile synthesis, and the context used while learning new memories. `filterByMetadata` limits which existing memories influence an ingestion; it does not change the metadata written on the new document ([Ingesting Context](https://supermemory.ai/docs/ingestion/add-memories), [User Profiles](https://supermemory.ai/docs/recall/user-profiles)).
- Profile buckets organize facts by topic independently from static/dynamic lifespan. Precise bucket descriptions improve classification ([User Profiles](https://supermemory.ai/docs/concepts/user-profiles)).

### Recommendation for Cloudflare OS

Use a small controlled metadata vocabulary, not ad hoc keys:

```text
source: cloudflare-os | codex | browser | github | supermemory-connector
kind: decision | workflow | agent | task-result | research | runbook | deployment | incident
registry_id: ignitabull.<kind>.<domain>.<slug>
environment: local | staging | production
repository: cloudflare-os | cloudflare-os-deployment
branch: codex/codex-subscription-cloudflare
status: proposed | active | superseded | failed | verified
sensitivity: normal | restricted
occurred_at: RFC3339 timestamp
```

Suggested profile buckets:

- `preferences`: explicit operator preferences only; exclude inferred traits.
- `decisions`: accepted architectural and product decisions, including why.
- `workflows`: workflow IDs, purposes, triggers, inputs, outputs, and owners.
- `agents`: agent IDs, roles, capabilities, boundaries, and deployment locations.
- `operations`: current environments, deployment topology, known issues, and verified state.

Use `filterByMetadata` only to keep genuinely separate subdomains from influencing one another; do not use it as a substitute for a permission boundary.

## 4. Retrieval pattern

### Official facts

- Profiles provide broad always-relevant context; search provides query-specific details. The profile endpoint can return both in one call with `q` ([User Profiles](https://supermemory.ai/docs/recall/user-profiles)).
- Hybrid search covers memories and document chunks. Threshold trades recall for precision, and reranking can improve relevance with documented extra latency ([Search](https://supermemory.ai/docs/search)).
- Supermemory's documented “full context” pattern combines static profile, dynamic profile, and relevant results, using `threshold: 0.6` as an example ([User Profiles](https://supermemory.ai/docs/recall/user-profiles)).

### Recommendation for Cloudflare OS

1. **Session start:** call `getProfile()` and inject a bounded profile into agent context.
2. **Before substantive work:** call `recall(userRequest, { mode: "hybrid", threshold: 0.6, limit: 5 })`.
3. **Complex or high-stakes retrieval:** enable reranking; otherwise avoid its latency.
4. **Exact operational truth:** verify live state. Memory should guide discovery, never override the current worktree, runtime, browser, or deployment.

## 5. Automatic capture without memory pollution

### Official facts

- `customId` is recommended for deduplication and updates. Reusing it links new content to the same document and processes only changed/new content ([Ingesting Context](https://supermemory.ai/docs/ingestion/add-memories)).
- For long-running chats, Supermemory recommends a stable session/conversation ID, a consistent transcript prefix, and either full-growing transcripts or deltas—but not mixing the two for one ID ([Rules of Supermemory](https://supermemory.ai/docs/concepts/rules)).
- Official SDK middleware can automatically retrieve profiles and save conversations; saving can be disabled, and “full” mode combines profile and query retrieval ([Vercel AI SDK](https://supermemory.ai/docs/integrations/ai-sdk)).

### Recommendation for Cloudflare OS

Capture on **successful task stop**, not after every tool call. Write one canonical task document with a stable ID such as `cloudflare-os-task-<task-id>` containing:

- request and final outcome;
- decisions and their rationale;
- created/changed workflow or agent registry IDs;
- files, services, and deployment identifiers (never credentials);
- tests and live verification evidence;
- unresolved risks and the next action.

Append later turns under the same `customId`; use either deltas consistently or resend the entire growing task record consistently. Save failures only when they teach a reusable lesson. Exclude chain-of-thought, temporary scratch work, verbose command logs, tokens, headers, API keys, credentials, private payloads, and unreviewed model guesses.

For particularly important accepted decisions, also create a concise dynamic direct memory linked by metadata to the task's registry ID. This makes it easy to recall while preserving the source document as evidence.

## 6. Updates, forgetting, connectors, and hygiene

### Official facts

- Updating a memory creates a new version and preserves the old one with `isLatest=false`. Forgetting is a soft delete that removes a memory from search while retaining it as forgotten; scheduled expiry is available through `forgetAfter` ([Memory Operations](https://supermemory.ai/docs/recall/memory-operations), [Update Memory API](https://supermemory.ai/docs/api-reference/content-management/update-a-memory-creates-new-version)).
- Document deletion is permanent. Disconnecting a connector can either delete its imported documents or keep them; connectors support bounded document limits and periodic/manual synchronization ([Document Operations](https://supermemory.ai/docs/document-operations), [Connectors](https://supermemory.ai/docs/connectors/overview)).
- Supermemory explicitly recommends dry-running semantic bulk forgetting and then applying the reviewed IDs to prevent the final match set from drifting ([Memory Operations](https://supermemory.ai/docs/recall/memory-operations)).

### Recommendation for Cloudflare OS

- Update the original memory when a fact changes; do not add an opposite duplicate.
- Use `forgetAfter` for temporary incidents, short-lived priorities, release windows, and ephemeral environment state.
- Mark superseded decisions with a versioned replacement and a reason. Forget false or invalid memories immediately.
- Run a monthly review of active memories and a quarterly cleanup of old task documents/connectors. Preview any semantic bulk forget, then apply exact reviewed IDs.
- Add connectors only for authoritative corpora worth continuously syncing. Assign every connector only to the dedicated Cloudflare OS container, add source metadata, set a document limit, monitor sync status, and disconnect with explicit delete/keep intent.
- Treat connected documents as context, not as live truth: current Cloudflare changelogs, deployments, and repositories still require live verification before action.

## Initial seed memories

Recommended initial direct memories for the dedicated container:

1. “Cloudflare OS assets use stable IDs in the form `ignitabull.<kind>.<domain>.<slug>`; versions, environments, providers, and runtimes are metadata, not part of the permanent ID.” — static.
2. “Cloudflare OS should reuse an existing registered workflow, agent, or capability before creating a duplicate.” — static.
3. “Cloudflare OS keeps as much infrastructure on Cloudflare as practical; external Postgres is considered only when Cloudflare-native storage is insufficient.” — dynamic, because architecture may evolve.
4. “Claims about current code, runtime, browser, or deployment state must be verified live; remembered state is discovery context, not proof.” — static.
5. “The dedicated Supermemory container stores Cloudflare OS operational context only and must not mix with general personal memories.” — static.

Seed the container with the entity context and buckets before broad automatic capture. Then save this research note itself as the first source document so the operating policy remains searchable and auditable.
