# CLAUDE.md - Vocion

## Project Overview

Vocion is a multi-tenant SaaS application built on Next.js 16. It provides contextual intelligence tools for teams to organize, connect, and act on business context.

## Tech Stack

- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript (strict)
- **Retrieval:** Native first-party — pgvector (HNSW cosine) + Postgres FTS (tsvector + ts_rank), reciprocal rank fusion, optional LLM rerank. No third-party retrieval engine.
- **Connectors:** First-party `SourceConnector` interface (`libs/sources/`). Sync orchestrated by `SourceSyncService` (Temporal async workflow queued). Built-in: `web`. Demo: `local-files` (see Phase B).
- **Styling:** Tailwind CSS 4 + Shadcn UI (Radix primitives)
- **Auth:** NextAuth (v0.3+) with multi-tenancy via accounts/projects + RBAC
- **Database:** PostgreSQL (Docker Compose; pgvector/pgvector:pg16) + Drizzle ORM
- **Payments:** Stripe (optional, subscriptions)
- **API:** oRPC (end-to-end type-safe RPC)
- **i18n:** next-intl + Crowdin (en, fr)
- **Testing:** Vitest (unit) + Playwright (E2E)
- **Error Monitoring:** Sentry + Spotlight (dev)
- **Logging:** LogTape + Better Stack

## Essential Commands

```bash
npm install               # Install dependencies
npm run dev               # Start dev server (includes PGLite DB + Spotlight)
npm run dev:next          # Next.js dev only (no DB server)
npm run build             # Production build with migrations
npm run test              # Unit tests (Vitest)
npm run test:e2e          # E2E tests (Playwright)
npm run lint              # ESLint
npm run lint:fix          # ESLint autofix
npm run check:types       # TypeScript type checking
npm run check:deps        # Check unused dependencies (knip)
npm run check:i18n        # Validate i18n translations
npm run db:generate       # Generate Drizzle migrations
npm run db:migrate        # Apply migrations
npm run db:studio         # Open Drizzle Studio (visual DB browser)
npm run storybook         # Run Storybook
npm run stripe:listen     # Listen to Stripe webhooks locally
npm run stripe:setup-price # Create Stripe prices
```

## Retrieval stack

Native — no third-party retrieval engine. Three tables under `models/Schema.ts` (`Native pgvector retrieval` section):
- `knowledge_source` — one row per registered source connector
- `knowledge_document` — ingested document (with content-hash dedup, tombstone-on-missing)
- `knowledge_chunk` — ~512-token chunk with `embedding vector(1536)` (HNSW cosine) + generated `tsv` (GIN FTS)

Read path: `services/RetrievalService.search(query, { orgId, mode: 'hybrid'|'vector'|'keyword', sourceSlugs?, rerank? })`. Returns ranked `SearchHit[]` (chunkId, documentId, sourceSlug, content, score). Hybrid uses reciprocal rank fusion across vector + keyword arms.

Write path: `services/IngestionService.ingestDocument()` — chunks via `libs/retrieval/chunker.ts` (512 tokens, 64 overlap), embeds via OpenAI `text-embedding-3-small`, upserts into the chunk + document tables in a single transaction.

Connectors implement `libs/sources/types.ts` `SourceConnector` interface (`sync(ctx): AsyncIterable<IngestDoc>`). Registry at `libs/sources/registry.ts`. Sync orchestrator: `services/SourceSyncService.runSync(orgId, sourceId, onProgress?)` — synchronous today; Temporal async variant queued.

Port map: Vocion :3000, Postgres :5432, Langfuse :3200, Temporal UI :8233. See `infra/README.md` for the platform compose.

## Running with Docker PostgreSQL

```bash
docker compose up -d      # Start PostgreSQL on port 5432
npm run db:migrate        # Apply migrations
npm run dev:next          # Start Next.js (skip built-in PGLite)
```

The default `npm run dev` uses PGLite (in-process SQLite-like PG). For a real PostgreSQL instance, use docker-compose.yml.

## Key Directories

```
src/
├── app/[locale]/          # Next.js App Router pages (i18n)
│   ├── (marketing)/       # Landing page (public)
│   ├── (auth)/            # Authenticated pages
│   │   ├── dashboard/     # Dashboard, todos, billing, settings
│   │   └── (center)/      # Clerk sign-in/sign-up
│   ├── rpc/               # oRPC API routes
│   └── webhook/           # Stripe webhook handler
├── components/ui/         # Shadcn UI components
├── features/              # Feature-specific components
├── libs/                  # Config: DB, Env, I18n, Stripe, oRPC
├── models/Schema.ts       # Drizzle ORM schema (organization, todo tables)
├── routers/               # oRPC route handlers + auth guards
├── services/              # Business logic (Billing, Todo, Organization)
├── templates/             # Page-level templates (Navbar, Hero, Footer, etc.)
├── types/                 # TypeScript types
├── utils/AppConfig.ts     # App name, pricing plans, locale config
└── locales/               # Translation files (en.json, fr.json)

workspace/                   # Git-backed client context
└── <org>/                 # Per-tenant authoring directory
    ├── agents/            # YAML — slug, prompt, subagents, suggestions
    ├── operations/        # v0.2: renamed from skills/. Typed LLM calls.
    ├── playbooks/         # v0.2: markdown + YAML procedural guides
    ├── learnings/         # v0.2: whitelisted rule-step buckets
    ├── evals/             # v0.2: eval datasets per agent
    ├── workflows/         # YAML — sequential steps with approve gates
    └── objects/           # YAML — business object type definitions
```

## Context as Code

Every authored resource lives in `workspace/<org>/` as YAML + markdown — never hardcoded in TS. Edit the files, then:

```bash
npm run workspace:check      # validate + diff
npm run workspace:apply      # sync to DB; records a workspace_version row
```

Every operation run + agent run + eval run stamps the active `workspace_sha` so you can trace any output back to the exact prompts that produced it. See `workspace/README.md` for authoring.

## Agent runtime (v0.2)

Agents run on **LangChain.js + `deepagents@1.10`**. The runtime gives you subagents (declared per-agent in YAML), a per-request virtual filesystem mounting playbooks at `/playbooks/<slug>/` and rendered learnings at `/learnings/<step>.md`, built-in `write_todos` + filesystem tools, and SSE streaming with 15s keepalives. See [`docs/internal/adr/0001-langchain-deepagents.md`](./docs/internal/adr/0001-langchain-deepagents.md).

Opt in by setting `VOCION_AGENT_RUNTIME=deepagents` and pointing the chat at `/rpc/agent/stream`. Default model: `claude-sonnet-4-6` (main) + `claude-haiku-4-5-20251001` (classifier). Override per-role via `VOCION_LLM_MODEL_MAIN` etc.

## Background worker

The comment-feedback loop ships as a separate process (Next.js doesn't host long-lived workers):

```bash
ENABLE_FEEDBACK_WORKER=1 npm run worker:serve
# or
docker compose --profile worker up -d
```

Opt-in via the env flag. Drains `feedback_job` rows queued by Drive webhooks, classifies via Haiku, and writes the classification back. Self-improver subagent surfaces candidates for user approval; main agent commits via `add_learning`.

## Evals + budgets

- `npm run eval:run -- --dataset <slug>` — run a context-authored dataset through the agent and score each case via an LLM judge. CI exits non-zero if pass-rate < 0.8.
- `agent_budget` table caps per-period token + dollar spend per agent. Pre-flight refusal in `runAgentDeep` when over the hard cap. Opt-in: no row → no enforcement.

## Observability

Self-hosted **Langfuse** (in `infra/docker-compose.platform.yml`) traces every LLM call with normalized tags — `feature:<name>`, `org:<orgId>`, `slug:<slug>` — plus `userId` and `sessionId`. UI at http://localhost:3200; admin login lives in `infra/.env.langfuse.local` (gitignored); project `demo`, keys `pk-lf-vocion-demo` / `sk-lf-vocion-demo`.

```bash
npm run langfuse:smoke      # verify the stack accepts + returns a trace
npm run langfuse:bootstrap  # one-time: register Claude 4.6 / 4.7 / Haiku 4.5 pricing
```

`libs/Langfuse.ts` exposes `traceFor({ feature, slug, orgId, userId })` — use it from any new LLM path so traces stay sliceable. See [`docs/guides/observability.md`](./docs/guides/observability.md).

## Multi-Tenancy

- Clerk organizations provide multi-tenancy
- Each org has its own Stripe subscription stored in the `organization` DB table
- Data is scoped by org (via `auth()` orgId)
- Roles: `org:admin`, `org:member` (defined in `src/types/Auth.ts`)
- Enable organizations in Clerk Dashboard > Organization management > Settings

## Database Schema

- **organization** - Clerk org ID, Stripe subscription fields, timestamps
- **todo** - Sample CRUD entity scoped to user/org

To modify: edit `src/models/Schema.ts`, then `npm run db:generate && npm run db:migrate`.

## Environment Setup

Copy `.env.example` to `.env.local` and fill in your keys. Required 3rd-party services:
1. **Clerk** - Auth (publishable key + secret key)
3. **PostgreSQL** - Database (local via Docker or PGLite, production via Neon/Supabase/etc.)

Optional: Stripe (payments), Sentry, Better Stack, Checkly, Crowdin.

## Key Directories (Infrastructure)

```
infra/
├── README.md                       # Full infrastructure docs
├── docker-compose.platform.yml     # Postgres + Langfuse + Temporal compose
├── temporal/                       # Temporal worker entrypoint + activities
├── otel/                           # OpenTelemetry collector config
├── aws/                            # AWS deploy stubs
└── terraform/                      # IaC

requirements/                       # Product specs and case studies
├── overview.md                  # Platform vision
├── architecture.md              # System architecture
├── sales-assistant-*.md                   # the Sales Assistant sales agent case study
└── ...
```

## Conventions

- Conventional Commits (enforced by commitlint + lefthook)
- ESLint with Antfu config
- Strict TypeScript
- T3 Env for validated environment variables
- All translations in `src/locales/` - developers maintain `en.json`
