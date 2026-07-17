# Vocion

> `@vocion/core` — the open framework for production AI workflows.

Context as code. Skills as plugins. Review surfaces built in.

## What this is

Vocion is a Next.js app + Postgres schema + MCP server + workflow runner. You author your work — **Sources, Objects, Skills, Workflows, Agents, and Missions** — as YAML + markdown in git, apply it to the database, and get a typed runtime with a unified human-review queue, observability, and a plugin ecosystem.

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

See [`docs/reference/repo-architecture.md`](./docs/reference/repo-architecture.md) for the full layered model + versioning + compatibility rules.

## The five resources

Everything you author lives in a **workspace** — a git-backed directory of YAML + markdown that sits *outside* this repo, at the peer level of the checkout (`../workspace/<org>/`). Scaffold one with `npm run workspace:scaffold -- <name>`; see [`docs/workspace.md`](./docs/workspace.md) for the full authoring guide.

| Block | Path | Shape |
|---|---|---|
| **Source** | `workspace/<org>/sources/<slug>/source.yaml` | Auth, retrieval overrides, indexing filters |
| **Object** | `workspace/<org>/objects/<slug>/type.yaml` | Business entity (Account, Deal, …) with source weights |
| **Skill** | `workspace/<org>/skills/<slug>/skill.yaml` + `prompt.md` | LLM-powered unit of work, typed input/output |
| **Workflow** | `workspace/<org>/workflows/<slug>/workflow.yaml` | Sequence of skills + HITL approve gates |
| **Agent** | `workspace/<org>/agents/<slug>.yaml` + `<slug>.system-prompt.md` | LLM orchestrator wiring skills + workflows |

Apply to DB with `npm run workspace:apply -- <path> --project <id|slug>`. Every apply records a `workspace_version` audit row; every `skill_run` stamps the `workspace_sha` so any output traces back to the exact prompts that produced it.

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

See [`docs/guides/writing-a-plugin.md`](./docs/guides/writing-a-plugin.md) for the full authoring guide.

## Getting started

```bash
# 1. Clone + install
git clone <repo-url>
cd vocion-core
npm install

# 2. Configure env
cp packages/core/.env.example packages/core/.env.local
# Edit .env.local — at minimum set DATABASE_URL, Clerk keys, and one LLM provider key

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

The workspace is where all tenant context lives — agents, operations, playbooks, workflows, object types. It's a separate git-tracked directory (usually its own repo, or a directory in the deployment repo that carries vocion-core as a submodule), so client context is reviewable in PRs and never mixed into core. Set `WORKSPACE_PATH` wherever the app runs; without it no workspace is configured. Authoring guide: [`docs/workspace.md`](./docs/workspace.md).

Full install topology, env vars, production deploy, and troubleshooting: [`docs/guides/self-hosting.md`](./docs/guides/self-hosting.md).

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

## Retrieval

Native first-party. pgvector (HNSW cosine) + Postgres FTS (GIN tsvector) with reciprocal rank fusion across the two arms, optional LLM rerank. No third-party retrieval engine. Swap embedders, rerankers, chunking strategies per-org or per-source via `workspace/<org>/retrieval.yaml` — no code change needed.

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
docs/                            # Concepts, guides, reference
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

- [`docs/README.md`](./docs/README.md) — docs index
- [`docs/concepts/`](./docs/concepts/) — the five resources, one page each (~15 min read end-to-end)
- [`docs/guides/`](./docs/guides/) — quickstart, authoring, plugin, self-hosting, tenant extraction
- [`docs/reference/`](./docs/reference/) — MCP tools, repo architecture, retrieval config, auth

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for commit conventions, local checks, and
the contributor licensing terms (MPL 2.0 inbound + DCO sign-off). In short:
conventional commits (enforced by commitlint + lefthook), `git commit -s` to sign
off, and run `npm run check:types`, `npm test`, `npm run lint` before committing.
