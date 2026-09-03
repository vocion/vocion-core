# Vocion

> `@vocion/core` — the open framework for production AI workflows.

Context as code. Skills as plugins. Review surfaces built in.

**New here?** [**Getting started — build an agent workforce from zero**](./docs/getting-started.md) walks you from an empty directory to a working workforce, one file type at a time. No code required.

## What this is

Vocion is a Next.js app + Postgres schema + MCP server + workflow runner. You author your work — **Sources, Objects, Skills, Playbooks, Workflows, Missions, Automations, Agents, and Teams** — as YAML + markdown in git, apply it to the database, and get a typed runtime with a unified human-review queue, observability, and a plugin ecosystem.

It's built for the part most agent frameworks skip — **operating** AI in production:

- **Three work modes, one runtime** — structured **Workflows**, open-ended **Missions** (a team of agents plans, works, and produces artifacts under review), and multi-agent **Teams**.
- **Connect the real systems** — a built-in connector pack (Google Ads, GA4, HubSpot, Gmail, Slack, Google Drive) on a durable, incremental, **client-scoped** ingestion pipeline.
- **A multi-tenant control plane** — tenant Bearer tokens that resolve to a permission principal, a **write API** (drive the review queue over REST), and **MCP over HTTP** (the agent/tool plane) — every mutation, token or human, routed through one authorization model.
- **Safe by construction** — discovery-vs-mutation permissions, an autonomy ladder with approval gates, and cross-client isolation enforced at the query, not the prompt.

## Layered architecture

This repo is `@vocion/core`. The full platform is layered:

| Layer | npm | Purpose |
|---|---|---|
| `@vocion/core` | this repo | Framework, dashboard, Postgres schema, MCP server, workflow runner |
| `@vocion/sdk` | `packages/sdk` | Stable plugin contract — Skill, PluginManifest, LLM client types |
| `@vocion/plugin-*` | `packages/plugins/*` | Connectors + skills shipped as separate npm packages |
| `vocion-starter` | separate repo (planned) | Forkable example install — quick start in 10 minutes |

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the layered model, versioning, and compatibility rules.

## What you author

Everything you author lives in a **workspace** — a git-backed directory of YAML + markdown that sits *outside* this repo, at the peer level of the checkout (`../workspace/<org>/`). Scaffold one with `npm run workspace:scaffold -- <name>`; see [`docs/workspace.md`](./docs/workspace.md) for the authoring guide and [`docs/entities/`](./docs/entities/) for a field-by-field reference of every file type.

| Entity | Path (inside `workspace/<org>/`) | Shape |
|---|---|---|
| **[Workspace manifest](./docs/entities/workspace-manifest.md)** | `workspace.yaml` | Org id, name, workspace lead, defaults, dashboard surfaces, base-pack pin |
| **[Agent](./docs/entities/agent.md)** | `agents/<slug>.yaml` + `<slug>.system-prompt.md` | LLM orchestrator: prompt, hierarchy, skills, sources, harness settings |
| **[Team](./docs/entities/team.md)** | `teams/<slug>.yaml` | Agents grouped under a lead, with an accountable human |
| **[Skill](./docs/entities/skill.md)** | `skills/<slug>/SKILL.md` | Frontmatter + markdown procedure, read on the model's judgement |
| **[Playbook](./docs/entities/playbook.md)** | `playbooks/<slug>/SKILL.md` | Standing context attached to a skill or an agent by name |
| **[Mission](./docs/entities/mission.md)** | `missions/<slug>.yaml` | Standing responsibility: goal, success criteria, autonomy level |
| **[Workflow](./docs/entities/workflow.md)** | `workflows/<slug>/workflow.yaml` | Deterministic steps with approve / ask gates |
| **[Automation](./docs/entities/automation.md)** | `automations/<slug>.yaml` | The only place time and events live: `when` → `do` |
| **[Object type](./docs/entities/object-type.md)** | `objects/<slug>/type.yaml` | Business entity (Account, Deal, …) with source weights + classification prompt |
| **[Source](./docs/entities/source.md)** | `sources/<slug>.yaml` | Connector kind, config, sync + reconcile cadence, per-source access (no credentials) |
| **[Trust rules](./docs/entities/trust.md)** | `trust.yaml` | Which actions may auto-execute, and above what confidence |
| **[Learning step](./docs/entities/learning-step.md)** | `learnings/<name>.yaml` | Named bucket of accumulated rules an agent reads |
| **[Eval dataset](./docs/entities/eval-dataset.md)** | `evals/<slug>.yaml` | Per-agent test cases for `npm run eval:run --workspace @vocion/core` |
| **[Workspace page](./docs/workspace-pages.md)** | `pages/<slug>.yaml` | Tenant-defined dashboard page, derived from a core archetype (file-only) |

A **[base pack](./docs/entities/base-pack.md)** ships inside core at `packages/core/templates/base/` and layers *underneath* a workspace: pin it with `extends: core@<version>`, activate the agents you want with `use:`, and override any default with a same-slug file marked `extends: core`.

Apply to DB with `npm run workspace:apply -- <path> --project <id|slug>`. Every apply records a `workspace_version` audit row; every `tool_call` stamps the `workspace_sha` so any output traces back to the exact prompts that produced it.

## Plugin contract

A plugin is an npm package that exports a manifest. Core loads manifests at boot via `@vocion/sdk`. Typed, distributable, independently versioned.

```ts
import type { PluginManifest } from '@vocion/sdk';
import { defineSkill } from '@vocion/sdk';
import { z } from 'zod';

const highlights = defineSkill({
  slug: 'transcript_highlights',
  name: 'Transcript Highlights',
  version: '0.1.0',
  provider: 'openai',
  requiresApproval: false,
  inputSchema: z.object({ transcript: z.string() }),
  outputSchema: z.object({ highlights: z.array(z.object({ quote: z.string() })) }),
  async run(ctx, input) {
    // ... multi-pass LLM, chunking, whatever you need
  },
});

export default {
  id: 'acme.samples',
  version: '0.1.0',
  skills: [highlights],
} satisfies PluginManifest;
```

The reference plugin lives at `packages/plugins/transcript-highlights/`; the contract it implements is `@vocion/sdk`.

## Getting started

```bash
# 1. Clone + install
git clone <repo-url>
cd vocion-core
npm install

# 2. Configure env
cp packages/core/.env.example packages/core/.env.local
# Edit .env.local — at minimum set DATABASE_URL, Clerk keys, and one LLM provider key.
# That provider key is the fallback: a workspace that stores its own is billed on
# its own account instead. See "API credentials" below.

# 3. Start the platform (Postgres + Langfuse + Temporal)
npm run dev:up

# 4. Apply schema
npm run db:migrate

# 5. Scaffold your workspace — created at ../workspace/<name>, beside this checkout
npm run workspace:scaffold -- {workspace_name}

# 6. Point the app at it and apply it to the DB
export WORKSPACE_PATH=../workspace/{workspace_name}
npm run workspace:apply -- ../workspace/{workspace_name}

# 7. Run dev server
npm run dev:next
# → http://localhost:3000
```

The workspace is where all tenant context lives — agents, teams, skills, playbooks, missions, workflows, automations, object types, sources. It's a separate git-tracked directory (usually its own repo, or a directory in the deployment repo that carries vocion-core as a submodule), so client context is reviewable in PRs and never mixed into core. Set `WORKSPACE_PATH` wherever the app runs; without it no workspace is configured. Authoring guide: [`docs/workspace.md`](./docs/workspace.md).

Environment topology and deploy patterns: [`docs/deployment/multiple-environments.md`](./docs/deployment/multiple-environments.md) and [`docs/deployment/parent-project-pattern.md`](./docs/deployment/parent-project-pattern.md).

## MCP server

Author skills + workflows and inspect runs from Claude Code, Cursor, Zed, or any MCP client.

**Local (stdio)** — single-tenant, for a developer's IDE:

```bash
claude mcp add vocion -- npm --prefix /abs/path/to/vocion-core run mcp:serve
```

**Remote (HTTP)** — multi-tenant. One endpoint, the org derived from a tenant Bearer token, every tool call scoped to that org under the same permission model as a human:

```
POST https://your-install/api/mcp
Authorization: Bearer vcn_live_...
```

Full tool reference + the HTTP transport: [reference/mcp](https://vocion.ai/docs/reference/mcp).

## Control plane (REST + MCP)

For an app or a client integration to drive Vocion — start work, approve, manage scopes — use a tenant **Bearer token** (`vcn_live_…`), which resolves into a permission principal. The **write API** exposes the unified review queue over HTTP (`GET /api/v1/reviews`, `POST /api/v1/reviews/decide`); MCP-over-HTTP exposes the agent/tool plane. Both are multi-tenant and Bearer-scoped, and a token mutation is governed exactly like a human action. See the [API reference](https://vocion.ai/docs/api).

## API credentials

Credentials travel in both directions, and both live under **Dashboard → API credentials**.

**Inbound — tokens Vocion mints.** A `vcn_live_…` Bearer token is what an outside tool presents *to* Vocion, as above. Vocion generates the secret, stores only its SHA-256, and shows the plaintext once. A workspace holds as many as it has integrations.

**Outbound — keys the workspace supplies.** A workspace can paste the key it already holds with a model vendor (OpenAI, Anthropic, Vertex, Azure OpenAI, AWS, or anything else). It is encrypted at rest with AES-256-GCM under a per-org data encryption key, and Vocion uses it when it calls out on that workspace's behalf — so the workspace's own vendor account is billed, not the operator's. One live key per platform per org: saving a second revokes the first.

**Which key a call uses.** Every outbound vendor call resolves the same way — **the workspace's own stored key first, the server's environment variable second.** That covers chat models, embeddings on ingest and on query, the rerank pass, the vision tool and image generation. A workspace that has supplied nothing behaves exactly as it did before, on `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`. Two internal paths stay on the server's key by design, because no workspace is in scope where they run: discovery detection and the feedback classifier.

Supplied keys never carry a Vocion-side expiry — the vendor that issued the key owns its lifetime. Revoking or replacing is how one ends.

Encryption at rest is configured by `VOCION_CREDENTIAL_VAULT`: `local` wraps the per-org key with `VOCION_CREDENTIAL_VAULT_KEY`, which puts the wrapping key and the wrapped key in the same database and is only appropriate for development; `kms` wraps it with AWS KMS under `VOCION_KMS_KEY_ARN`, which is what any install holding real customer keys should run.

## Retrieval

Native first-party. pgvector (HNSW cosine) + Postgres FTS (GIN tsvector) with reciprocal rank fusion across the two arms, optional LLM rerank. No third-party retrieval engine. Embedding and rerank models are environment-level knobs (`VOCION_EMBEDDING_MODEL`, `VOCION_RERANK_MODEL`), though the key each one spends comes from the workspace when it has stored one (see [API credentials](#api-credentials)); per-type and per-agent retrieval weighting is authored in the workspace (`sourceRelevance` on an object type, `searchConfig` on an agent) — no code change needed.

## Tech stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript strict
- **Database:** PostgreSQL 16 + Drizzle ORM
- **Auth:** Clerk (multi-tenant, RBAC via Clerk organizations)
- **LLM:** OpenAI, Anthropic — swappable per skill via the `provider` field
- **Retrieval:** pgvector + Postgres FTS, RRF hybrid, optional LLM rerank (first-party)
- **Observability:** Langfuse (LLM traces), OpenTelemetry (spans + metrics)
- **Workflows:** in-process durable step runner on Postgres

## Repo layout

```
packages/
├── core/                        # Next.js app + Postgres schema + MCP + workflow runner
├── sdk/                         # @vocion/sdk — stable plugin contract
└── plugins/
    └── transcript-highlights/   # Reference sample plugin

workspace/<org>/                   # Tenant-owned YAML + markdown (per-tenant workspace repo)
docs/                            # Workspace guide, per-entity reference, object model, deployment
```

## License

`@vocion/core` is **source-available under the [Mozilla Public License 2.0](LICENSE)**
— an OSI-approved open-source license. You can use, self-host, inspect, modify,
and build around it, and embed it in a larger proprietary system. MPL is
file-level copyleft: when you *distribute* modified Vocion files, those files stay
open under the MPL, but your surrounding application code stays yours.

**You own your intelligence.** Your data, business context, agent configurations,
workflows, evaluation history, and operational outputs remain yours. Vocion is
deployable in your environment and portable to another qualified engineering
partner — Metacto cannot hold your operating intelligence hostage.

Some uses — white-labeling Vocion itself, distributing it under a proprietary
license, a Metacto-supported managed service, proprietary enterprise modules, or
commercial warranties/indemnification/SLAs — need a separate agreement. See
[COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

"Vocion" and the Vocion logos are trademarks of Metacto, Inc.; the MPL does not
grant trademark rights.

## Docs

- [`docs/getting-started.md`](./docs/getting-started.md) — **start here**: zero to a working agent workforce, with an example of every entity type
- [`docs/README.md`](./docs/README.md) — docs index
- [`docs/workspace.md`](./docs/workspace.md) — workspace-as-code: create, author, apply, base packs, commands
- [`docs/entities/`](./docs/entities/) — one page per authored entity type, field by field
- [`docs/object-model.md`](./docs/object-model.md) — where every object is authored, stored, executed, and shown
- [`docs/workspace-pages.md`](./docs/workspace-pages.md) — tenant-defined dashboard pages
- [`docs/deployment/`](./docs/deployment/) — multiple environments, parent-project pattern

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for commit conventions, local checks, and
the contributor licensing terms (MPL 2.0 inbound + DCO sign-off). In short:
conventional commits (enforced by commitlint + lefthook), `git commit -s` to sign
off, and run `npm run check:types`, `npm test`, `npm run lint` before committing.
