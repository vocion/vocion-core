# Observability

Vocion ships with a self-hosted **Langfuse** stack for LLM tracing, token accounting, and USD cost attribution. Every LLM call — agent turn, operation, eval-judge, classifier — emits a trace tagged with `org`, `user`, `feature`, and `slug`, so you can slice usage by tenant, by feature, by agent, or down to a single call.

## Local boot

The platform compose at `infra/docker-compose.platform.yml` is included by the root `docker-compose.yml`, so `docker compose up -d` brings the whole stack online:

| Service | Port | Purpose |
|---|---|---|
| `langfuse-web` | http://localhost:3200 | UI + ingestion API |
| `langfuse-worker` | — | async ingestion → ClickHouse |
| `langfuse-postgres` | — | metadata |
| `langfuse-clickhouse` | — | trace storage |
| `langfuse-redis` | — | queue |
| `langfuse-minio` | — | blob storage for large payloads |

First boot takes 60-90 s while Postgres + ClickHouse migrations run. When `curl http://localhost:3200/api/public/health` returns `{"status":"OK"}`, the stack is ready.

### Auto-init defaults

The compose env bakes in a dev project so you don't have to click through the wizard:

| Field | Value |
|---|---|
| UI URL | http://localhost:3200 |
| Login | see `infra/.env.langfuse.local` (gitignored) |
| Org | `vocion` (`Vocion`) |
| Project | `demo` (`Demo`) |
| Public key | `pk-lf-vocion-demo` |
| Secret key | `sk-lf-vocion-demo` |

The admin login lives in `infra/.env.langfuse.local` — a gitignored file each developer fills in on their own machine. The compose file falls back to `admin@vocion.com` / `vocion-admin` on a fresh clone if the file is missing.

Run compose with the env file so the init vars get picked up on **first boot**:

```bash
docker compose -f infra/docker-compose.platform.yml \
  -p vocion-platform \
  --env-file infra/.env.langfuse.local \
  up -d
```

Note: `LANGFUSE_INIT_USER_*` only matters when `langfuse_pg_data` is empty. To rotate creds after first boot, either change the user via the Langfuse UI or wipe the volume and re-init.

The project / key fallbacks live in `libs/Langfuse.ts` and apply when `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_BASE_URL` envs are unset. Override them in `.env.local` for cloud Langfuse or a different self-hosted instance.

### Smoke test

```bash
npm run langfuse:smoke
```

Creates a trace + generation + span, flushes, then polls `/api/public/traces/<id>` until the row lands in ClickHouse. Non-zero exit on any failure. Use this in `dev:up` hooks or CI to catch a misconfigured stack early.

### One-time model pricing

Claude 4.6 / 4.7 / Haiku 4.5 are too recent to be in Langfuse's default price table. Register them once:

```bash
npm run langfuse:bootstrap
```

Reads `libs/pricing.ts` and POSTs each model to `/api/public/models`. Idempotent — re-run any time `libs/pricing.ts` changes.

## What gets traced

Every LLM-bearing path in Vocion emits a trace via `libs/Langfuse.ts` → `traceFor()`. The `feature` dimension is a closed enum in `libs/Langfuse/features.ts`:

| Feature | Where it's emitted | Trace `name` |
|---|---|---|
| `agent.chat` | `services/AgentService.runAgentDeep` (deepagents path) | `agent.chat:<agent-slug>` |
| `agent.dev` | `services/AgentService.runAgent` (legacy OpenAI loop) | `agent.dev:<agent-slug>` |
| `operation.run` | `services/SkillService.executeSkill` | `operation.run:<slug>` |
| `eval.judge` | `services/EvalService.runDataset` | `eval.judge:<dataset-slug>` |
| `workflow.step` | Temporal Activities under `services/temporal/activities` | `workflow.step:<step-name>` |
| `onyx.search` | `app/[locale]/rpc/onyx/route.ts` (live Onyx retrieval) | `onyx.search:live` |
| `feedback.classify` | `services/FeedbackWorkerService` (Haiku triage) | `feedback.classify:haiku` |
| `source.oauth` | OAuth token-refresh paths under `routers/Sources` | `source.oauth:<source-slug>` |

Every trace stamps:

- `userId` — the Clerk user, or `system` / `worker` / `eval-runner` / `mcp` for non-interactive paths.
- `metadata.orgId` — the Clerk org.
- `metadata.feature` — the feature name (also exposed as a tag).
- `metadata.slug` — the agent / operation / dataset / source slug.
- `tags: ['feature:<name>', 'org:<orgId>', 'slug:<slug>']`.
- `sessionId` — conversation id, when the trace is part of a chat thread.

## Slicing in the UI

Open http://localhost:3200/project/demo/traces and use the filter bar:

- **Per tenant**: filter on `tags = org:<orgId>` and group by `tags` to compare orgs.
- **Per user**: filter on `userId = <clerkUserId>`.
- **Per feature**: filter on `tags = feature:operation.run` to isolate Operation runs from agent chat.
- **Per agent / operation**: filter on `tags = slug:<agent-or-operation-slug>`.
- **Single call**: open any trace → the Generations tab shows model, tokens (input / output / cache-read), latency, and Langfuse-computed USD cost.

Saved filters in the UI become shareable URLs; we deep-link to common ones from `/dashboard/observability` in the app.

## Cost accounting

Langfuse computes USD cost per generation when it knows the model. After `npm run langfuse:bootstrap` has run once against the project, every generation row shows `calculatedTotalCost`. Sum / group by tag for tenant or feature totals.

Cache-read tokens (Anthropic prompt caching) are recorded in `usageDetails.cache_read_input_tokens` so they appear on the trace; they are **currently billed at the full input rate** in Langfuse because the public CreateModel API does not yet accept a separate cache-read price. That overcharges cached prefixes by up to ~10× in the Langfuse cost view. The on-app `agent_budget` table uses `libs/pricing.ts` which DOES apply the 10× cache-read discount — so the two diverge for caching-heavy workloads (Langfuse high, `agent_budget` accurate). Treat `agent_budget` as the cap source and Langfuse as the upper bound until Langfuse exposes per-usage-key pricing on the public API.

**Source of truth.** The `agent_budget` table inside Vocion is the **cap source** — it enforces hard limits at request time. Langfuse is the **audit / exploration surface**. The two agree on totals within < 5 % (sampling lag) for non-caching workloads. If they diverge persistently outside that band, investigate the ingestion pipeline.

## Production

On the AWS deploy the same compose stack runs alongside the app. Env vars to set in Secrets Manager (already templated in `infra/aws/.env.production.example`):

- `LANGFUSE_BASE_URL` — internal URL (`http://langfuse-web:3000`) for the app container; external URL (`https://langfuse.<your-domain>`) for the UI.
- `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` — keys for the prod project (do **not** reuse the `demo` keys).
- `LANGFUSE_PROJECT_ID` — used by the app for deep-links from `/dashboard/observability`.

Cloud Langfuse works too — point `LANGFUSE_BASE_URL` at `https://cloud.langfuse.com` and use the project keys from there. No code changes; the singleton in `libs/Langfuse.ts` is URL-driven.
