# Vocion

> `@vocion/core` — the open framework for production AI workflows.

Context as code. Skills as plugins. Review surfaces built in.

## What this is

Vocion is a Next.js app + Postgres schema + MCP server + workflow runner. You author **five things** — Sources, Objects, Skills, Workflows, Agents — as YAML + markdown in git, apply them to the database, and get a typed runtime with a review queue, observability, and a plugin ecosystem.

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

Everything you author lives in `context/<org>/` as YAML + markdown:

| Block | Path | Shape |
|---|---|---|
| **Source** | `context/<org>/sources/<slug>/source.yaml` | Auth, retrieval overrides, indexing filters |
| **Object** | `context/<org>/objects/<slug>/type.yaml` | Business entity (Account, Deal, …) with source weights |
| **Skill** | `context/<org>/skills/<slug>/skill.yaml` + `prompt.md` | LLM-powered unit of work, typed input/output |
| **Workflow** | `context/<org>/workflows/<slug>/workflow.yaml` | Sequence of skills + HITL approve gates |
| **Agent** | `context/<org>/agents/<slug>.yaml` + `<slug>.system-prompt.md` | LLM orchestrator wiring skills + workflows |

Apply to DB with `npm run context:apply`. Every apply records a `context_version` audit row; every `skill_run` stamps the `context_sha` so any output traces back to the exact prompts that produced it.

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

# 3. Start Postgres + Onyx (retrieval stack)
npm run dev:up

# 4. Apply schema + reference context
npm run db:migrate
npm run context:apply

# 5. Run dev server
npm run dev:next
# → http://localhost:3000
```

Full install topology, env vars, production deploy, and troubleshooting: [`docs/guides/self-hosting.md`](./docs/guides/self-hosting.md).

## MCP server

Author skills + workflows and inspect runs from Claude Code, Cursor, Zed, or any MCP client:

```bash
claude mcp add vocion -- npm --prefix /abs/path/to/vocion-core run mcp:serve
```

Full tool reference: [`docs/reference/mcp.md`](./docs/reference/mcp.md).

## Retrieval

pgvector + Postgres FTS with a config-driven hybrid pipeline. Swap embedders, rerankers, chunking strategies per-org or per-source via `context/<org>/retrieval.yaml` — no code change needed. (Onyx is wired today; pgvector-native pipeline lands in Phase 5.)

## Tech stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript strict
- **Database:** PostgreSQL 16 + Drizzle ORM
- **Auth:** Clerk (multi-tenant, RBAC via Clerk organizations)
- **LLM:** OpenAI, Anthropic — swappable per skill via the `provider` field
- **Retrieval:** Onyx (deprecating) → pgvector-native (next)
- **Observability:** Langfuse (LLM traces), OpenTelemetry (spans + metrics)
- **Workflows:** in-process durable step runner on Postgres

## Repo layout

```
packages/
├── core/                        # Next.js app + Postgres schema + MCP + workflow runner
├── sdk/                         # @vocion/sdk — stable plugin contract
└── plugins/
    └── transcript-highlights/   # Reference sample plugin

context/<org>/                   # Tenant-owned YAML + markdown (per-tenant context repo)
docs/                            # Concepts, guides, reference
```

## License

Apache 2.0.

## Docs

- [`docs/README.md`](./docs/README.md) — docs index
- [`docs/concepts/`](./docs/concepts/) — the five resources, one page each (~15 min read end-to-end)
- [`docs/guides/`](./docs/guides/) — quickstart, authoring, plugin, self-hosting, tenant extraction
- [`docs/reference/`](./docs/reference/) — MCP tools, repo architecture, retrieval config, auth

## Contributing

Conventional commits (enforced by commitlint + lefthook):

| Type | Purpose |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation |
| `refactor` | Code change (no feature/fix) |
| `test` | Tests |
| `chore` | Build/tooling |

Run `npm run check:types`, `npm test`, `npm run lint` before committing. Pre-commit hook handles auto-fix + type check + unused-dep check.
