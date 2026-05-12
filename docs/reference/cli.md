---
title: CLI reference
description: Every npm run script in @vocion/core — what it does, when to use it, what it needs.
nav_order: 20
---

# CLI reference

Every script declared in `packages/core/package.json`, grouped by purpose. Run from `packages/core/` unless noted.

## Local development

| Script | Purpose |
|---|---|
| `npm run dev` | Start the dev stack: PGLite database server + Next.js dev server + Spotlight error monitor. Fastest path to a working app. |
| `npm run dev:next` | Next.js dev server only. Use when you've started Postgres yourself (e.g. via root `docker compose up`). |
| `npm run dev:spotlight` | Spotlight UI for local Sentry error capture. Bundled into `npm run dev`. |
| `npm run build` | Full production build chain: `db:migrate` → `build:next` → `docs:index` (Pagefind). Requires `DATABASE_URL`. |
| `npm run build:next` | Just Next.js build. Skips migrations + Pagefind indexing. Used inside the Docker image build where DATABASE_URL isn't available. |
| `npm run build-local` | Like `build:next` but stands up an in-memory PGLite first. Useful for "does this compile in production mode?" checks. |
| `npm run start` | Serve the production build. Assumes `npm run build` has already run. |
| `npm run clean` | Delete `.next`, `out`, `coverage`. |

## Database

| Script | Purpose |
|---|---|
| `npm run db:generate` | Generate a Drizzle migration from schema changes in `src/models/Schema.ts`. |
| `npm run db:migrate` | Apply pending migrations against `$DATABASE_URL`. |
| `npm run db:studio` | Open Drizzle Studio in the browser — a visual query/edit UI for the live DB. |

## Context-as-code

Edit YAML + markdown in `context/<org>/`, then:

| Script | Purpose |
|---|---|
| `npm run context:check` | Dry-run validation: parses every file, computes the diff against the DB, prints what *would* change. Read-only. |
| `npm run context:apply` | Validate + write changes to the DB. Records a new `context_version` row + bumps `context_sha`. |
| `npm run context:export` | Pull the DB state back to disk — useful when editing via the dashboard UI and you want to commit the result. |

## Agents + workers

| Script | Purpose |
|---|---|
| `npm run mcp:serve` | Start the MCP server on stdin/stdout (for Claude Code, Cursor, Zed). |
| `npm run worker:serve` | Run the feedback worker loop. Opt-in via `ENABLE_FEEDBACK_WORKER=1`. |
| `npm run temporal:worker` | Run the Temporal worker for `vocionWorkflow` + ingestion activities. Opt-in via `ENABLE_TEMPORAL_WORKER=1`. |

## Evals

| Script | Purpose |
|---|---|
| `npm run eval:run -- --dataset <slug>` | Run a context-authored dataset through the agent + judge. Exits non-zero if pass-rate < 0.8 — wire into CI. |

## Observability

| Script | Purpose |
|---|---|
| `npm run langfuse:smoke` | Verify the local Langfuse stack accepts + returns a trace. Useful in `dev:up` post-boot hooks. |
| `npm run langfuse:bootstrap` | One-time: register Claude 4.6 / 4.7 / Haiku 4.5 + OpenAI model pricing via Langfuse's `/api/public/models` API. Idempotent. |

## Docs

| Script | Purpose |
|---|---|
| `npm run docs:index` | Run Pagefind against the built Next.js static output to produce the docs search index at `public/pagefind/`. Chained into `npm run build`. |
| `npm run docs:lint` | Walk every `.md` and report broken cross-document links. Exits non-zero on failure — wire into CI. |

## Quality + tests

| Script | Purpose |
|---|---|
| `npm run check:types` | TypeScript `tsc --noEmit`. Pretty output. |
| `npm run check:i18n` | Validate translation keys via `@lingual/i18n-check`. |
| `npm test` | Vitest unit tests. |
| `npm run test:e2e` | Playwright end-to-end tests. |
| `npm run lint` / `lint:fix` | ESLint (Antfu config). |

## Billing (optional)

| Script | Purpose |
|---|---|
| `npm run stripe:listen` | Forward Stripe webhooks to `localhost:3000/webhook/billing` for local testing. |
| `npm run stripe:setup-price` | One-shot to create Stripe prices for the configured PricingPlanList. |

## Storybook

| Script | Purpose |
|---|---|
| `npm run storybook` | Component dev environment on `:6006`. |
| `npm run storybook:test` | Vitest-driven Storybook stories. |
| `npm run build-storybook` | Static Storybook build for deployment. |

## Repo-root scripts

Run from the monorepo root (`/`), not `packages/core/`:

| Script | Purpose |
|---|---|
| `npm run dev:up` | Boot the full local platform: app DB + Langfuse + Temporal + OTel collector + Onyx (if installed). |
| `npm run dev:down` | Tear it all down. |
| `npm run dev:onyx:up` / `down` | Onyx-only stack (legacy; replaced by native pgvector retrieval in v0.3). |
