# Cloudflare OS community ecosystem

Checked 2026-08-11 PT (2026-08-12 UTC). Primary sources only.

## Answer

Yes, but it is a very young, scattered ecosystem rather than a mature marketplace. There are already a few genuinely reusable blueprints, agent skills, CLI tools, and Gatekeepers. There is no verified central public registry of community blueprints or skills yet; discovery currently means GitHub search, repository Discussions, or receiving a blueprint URL/`.gadget` archive directly.

## Reusable assets verified

| Asset | What is actually reusable | Maturity at check |
| --- | --- | --- |
| [Indobase format blueprints](https://github.com/Indobase/Indobase/tree/main/indobase-builder-cfos/formats) | Installable `.gadget` + JSON pairs for Docs, Sheets, Slides, and an original `format.design`. The Design source is included and implements canvas presets, layers, undo, and client-side PNG export. Its own [format README](https://github.com/Indobase/Indobase/blob/main/indobase-builder-cfos/formats/README.md) documents `FORMAT_BLUEPRINTS_DIR` installation. | Apache-2.0 repository; Design introduced [2026-08-07](https://github.com/Indobase/Indobase/commit/6b475f20ac50ecd268fa52df55ddf1f7437ecc1c). This is the clearest community blueprint found, but it is not a flowchart-specific editor. |
| [gadgetCLI](https://github.com/nook-space/gadgetCLI) | A terminal client for scaffolding, pulling, diffing, pushing, and logging Gadgets. It can publish/update blueprints, pack offline `.gadget` archives, and create/install from blueprint URLs. It also ships an installable [agent skill](https://github.com/nook-space/gadgetCLI/tree/main/skill). | MIT; repository created 2026-08-09; latest observed release was [v0.1.2 on 2026-08-10](https://github.com/nook-space/gadgetCLI/releases/tag/v0.1.2). Useful but extremely new. |
| [Twenty CRM Gatekeeper](https://github.com/emergedigital2024/cloudflare-os-gatekeeper-twenty) | A standalone drop-in `gatekeeper-twenty` package with actual Worker, configurator, and type source. Its README documents installation into `packages/`. | Apache-2.0; created 2026-08-07; no tagged release observed. Audit before production because a Gatekeeper is a security boundary. |
| [Telegram Gatekeeper](https://github.com/nabkey/telegram-gatekeeper) | Actual Gatekeeper source for bot/chat grants, reads, approval-queued writes, and inbound hooks. | Apache-2.0; created 2026-08-10. Its own README calls it early, manually validated software with no test suite. |
| [cloudflare-os-ops skill](https://github.com/ryoryo34/agent-skills/blob/main/cloudflare-os-ops/SKILL.md) | A Japanese operations runbook/agent skill covering Gatekeeper deployment and binding checks, model providers, secrets, and troubleshooting; includes a verification script. | Added [2026-08-11](https://github.com/ryoryo34/agent-skills/commit/a50dbb44ede363530be83e83e80cea15073820db). Independently authored and contains mutating deployment commands, so review it as a runbook rather than trusting it as automation. |

## Official extension pieces

- Cloudflare OS itself ships three bundled, reusable formats: Docs, Sheets, and Slides. The official [format-blueprints directory](https://github.com/cloudflare/cloudflare-os/tree/main/packages/workshop-backend/format-blueprints) also defines the supported fork/custom-deployment mechanism: a directory of `.gadget` + JSON pairs selected with `FORMAT_BLUEPRINTS_DIR`.
- The native [blueprint system](https://github.com/cloudflare/cloudflare-os/blob/main/docs/blueprints.md) supports share links at `/blueprint/<id>`, `.gadget` download/upload across Workshop instances, personal libraries, and admin-featured blueprints. Featured/Explore results are deployment-curated; they are not a global cross-deployment registry.
- The official repo includes one authoring skill, [`write-gatekeeper`](https://github.com/cloudflare/cloudflare-os/tree/main/.agents/skills/write-gatekeeper), for designing and implementing integrations.
- A deployment can also host ordinary `SKILL.md` files inside Context Library collections. The official [skill parser/catalog code](https://github.com/cloudflare/cloudflare-os/blob/main/packages/gatekeeper-context/src/agent-skill.ts) validates `name` and `description` frontmatter, exposes discovered skills in the agent catalog and slash-command picker, and expands `$ARGUMENT` when invoked. This means teams can build a private or admin-curated skill library inside Cloudflare OS even though no global community skill registry exists.
- The official [Cloudflare OS Starter](https://github.com/cloudflare/cloudflare-os-starter) is a reusable deployment/customization wrapper, not a blueprint catalog. It also includes a deployment-specific [`cloudflare-os-operator` skill](https://github.com/cloudflare/cloudflare-os-starter/blob/main/.agents/skills/cloudflare-os-operator/SKILL.md).

## Working prototypes and community activity

- An [OpenProject Gatekeeper discussion](https://github.com/cloudflare/cloudflare-os/discussions/77) links a fork branch containing a complete `packages/gatekeeper-openproject` source tree and tests. It remains a branch/proposal, not a packaged release.
- A [Sentry Gatekeeper discussion](https://github.com/cloudflare/cloudflare-os/discussions/7) links an [open fork PR](https://github.com/sergical/cloudflare-os/pull/1) with the connector source. It is a working proposal, not an upstream or independently released package.
- [cfos-showcase](https://github.com/watanabe3tipapa/cfos-showcase) publishes 55 Japanese setup/operations guides. Despite calling pages “Gadgets,” its repository contains no `.gadget` archives, so it is documentation rather than a reusable Gadget library.
- [AgenticAIJP/cloudflare-os-ja](https://github.com/AgenticAIJP/cloudflare-os-ja) is an active Japanese-localization fork. Other community wrappers found focus on deployment or alternate local runtimes, not shared blueprints.

The official repository was created on 2026-04-15 and, at this check, GitHub reported roughly 7,777 stars and 823 forks, but no tagged releases. Its [Discussions](https://github.com/cloudflare/cloudflare-os/discussions) area was enabled and had 19 threads, mostly support, ideas, and connector proposals. The official [contribution policy](https://github.com/cloudflare/cloudflare-os/blob/main/CONTRIBUTING.md) currently discourages substantial external PRs and directs big ideas to Discussions, which helps explain why larger integrations are appearing in forks and separate repositories.

## What was not verified

- No official or community-wide Cloudflare OS blueprint marketplace, package registry, “awesome” list, or global catalog was found.
- No Cloudflare OS-specific Discord was linked from the official repository or starter. GitHub Discussions is the only project-specific public community channel the official source identifies.
- The Kanban format mentioned in [Discussion #65](https://github.com/cloudflare/cloudflare-os/discussions/65), marketplace concepts in [Discussion #142](https://github.com/cloudflare/cloudflare-os/discussions/142), and several connector threads are proposals, not reusable shipped assets.
- Search results using “gadget” or “blueprint” produce false positives from unrelated projects. A reusable Cloudflare OS blueprint should resolve to a Workshop blueprint URL or include a valid `.gadget` archive, ideally with its source and binding requirements.

## Practical discovery/import path today

1. Start with GitHub Discussions and searches for `cloudflare-os gadget`, `cloudflare-os gatekeeper`, and actual `.gadget` files.
2. Prefer assets that include source, license, binding declarations, and reproducible build/test instructions.
3. Import a received `.gadget` through the Workshop Blueprints tab, or use its `/blueprint/<id>` link. For self-hosted default formats, use `FORMAT_BLUEPRINTS_DIR`; gadgetCLI adds terminal packaging and URL-based workflows.
4. Treat every community Gatekeeper and operations skill as untrusted until reviewed: they can mediate external credentials, writes, Cloudflare bindings, or deployment state.
