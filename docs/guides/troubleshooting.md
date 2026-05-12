---
title: Troubleshooting
description: Common Vocion failure modes and how to fix them — retrieval, runs, observability, MCP, Docker.
nav_order: 80
---

# Troubleshooting

When something's wrong, this page is the first stop. Each problem is grouped by surface; each fix names the file or command you'll touch.

## Retrieval

### Retrieval returns no results

Symptoms: an agent that should cite docs answers from general knowledge instead, or returns "I don't have access to that information."

Walk through:

1. **Confirm the source is ingested.** Open `/dashboard/knowledge`. The source you expect should show a non-zero document count and a recent `last_synced_at`. If `last_synced_at` is null or stale, click "Re-sync now" and watch the Temporal UI at `:8233` for the workflow.
2. **Check chunk counts.** `psql $DATABASE_URL -c "SELECT source_id, COUNT(*) FROM knowledge_chunk GROUP BY source_id;"`. Zero chunks means ingestion crashed before embedding completed.
3. **Embedding API errors.** Search Langfuse for `feature:retrieval.embed` traces with `level=ERROR`. The most common cause is a missing or rate-limited `OPENAI_API_KEY`.
4. **Org scoping mismatch.** Retrieval is `org_id`-scoped. If you're testing with a different Clerk org than the one that ingested the data, you'll see zero results. Confirm via the Clerk org switcher.

### Embedding spend is higher than expected

Inspect `feature:retrieval.embed` traces in Langfuse, group by `slug` (= source slug). Common culprits:

- A source whose plugin doesn't honor `content_hash` — every sync re-embeds unchanged content. Fix: make the plugin's `pull()` deterministic.
- Cache misses on query-side embeddings. Set `REDIS_URL` to enable the shared query cache.

## Agent runs

### Skill run hangs

If `/dashboard/review` shows a Skill stuck in `running` for > 5 minutes:

1. Check the Langfuse trace for the run (linked from the run detail page). Look for a generation that started but never ended.
2. Look for upstream timeouts: model API outage, retrieval call stuck, an external HTTP request without a timeout.
3. Kill the row: `UPDATE skill_run SET status = 'failed', error = 'manual:hung' WHERE id = <id>;`. The agent UI will refresh.
4. Add a timeout to the offending Skill (plugin code) or the LangChain call (raise via `signal: AbortSignal.timeout(60_000)`).

### "Budget exceeded" refusal

Pre-flight check on `runAgentDeep` refuses runs when the agent is over its hard cap. Either:

- Raise the cap via `/dashboard/agents/<slug>` (admin only).
- Wait for the next period (daily resets at UTC midnight, monthly at first of month).
- Delete the `agent_budget` row if you want to disable enforcement entirely.

### Token usage doesn't match Langfuse

Run-time tokens are tracked in `agent_budget.currentTokens` via the `chargeUsage` hook on every model turn. Langfuse reports its own count.

The two should agree within a few percent. If they diverge persistently (> 5%):

- The Langfuse adapter at `libs/Langfuse.ts` may be missing a generation. Check `feature:agent.chat` trace counts vs `skill_run` row counts.
- An agent invoking a non-LangChain LLM client (raw OpenAI SDK) won't fire the callback. Confirm every model invocation goes through `buildChatModel()` from `libs/llm`.

## Observability

### "No traces showing up"

Run `npm run langfuse:smoke` from `packages/core/`. If it fails:

- **Connection refused** — the platform compose isn't up. `docker compose -f infra/docker-compose.platform.yml up -d`.
- **Invalid creds** — `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` env mismatch with the local stack. Default dev keys are `pk-lf-corecontext-demo` / `sk-lf-corecontext-demo`.
- **Trace ingestion stalled** — restart `corecontext-langfuse-worker`. ClickHouse takes a few seconds to settle on first boot.

### Costs show `0` even though tokens flow

Langfuse needs model pricing to compute USD costs. Run `npm run langfuse:bootstrap` once per environment.

## MCP

### "MCP client can't connect"

Vocion's MCP server runs over stdio. Each client wires it differently — see [MCP reference](../reference/mcp.md). Common pitfalls:

- **Wrong path** — the client must spawn `npm run mcp:serve --workspace=@vocion/core` from the repo root.
- **Missing env** — Clerk + Database URL must be present. Check the client's logs for "[mcp] FATAL" lines.
- **Stale node_modules** — run `npm install` after pulling new versions.

## Docker / boot

### "Cannot find module '/app/docs/...'"

The runtime can't find the docs corpus. Usually means the Dockerfile didn't `COPY docs/` into the image (the Phase K.1 fix). Rebuild: `docker compose build app`.

### Postgres won't start

- **Port collision** — another Postgres instance bound to `:5432`. Stop it (`lsof -nP -iTCP:5432`) or change the port in `docker-compose.yml`.
- **Stale volume** — wipe with `docker volume rm corecontext-platform_pgdata` (this also wipes data; be sure).

### Temporal worker crashes on boot

Common: `temporal:7233` not reachable from the worker container. The platform compose must be up *first*:

```bash
docker compose -f infra/docker-compose.platform.yml up -d
docker compose --profile worker up -d temporal-worker
```

## Context apply

### `npm run context:apply` errors

- **YAML parse error** — line number is in the error; fix the syntax.
- **Schema validation failed** — read the Zod error; usually a missing required field on an Agent / Workflow / Operation. Use `npm run context:check` (dry-run) for a faster loop.
- **DB connection refused** — `$DATABASE_URL` not set. Make sure your shell env or `.env.local` has it.

## Build

### Next.js build crashes with "env validation failed"

Required env vars (`CLERK_SECRET_KEY`, `DATABASE_URL`, etc.) aren't set. For Docker builds, the Dockerfile passes stub values via `SKIP_ENV_VALIDATION=1` + dummy strings. Outside Docker, populate `.env.local` first.

## Where to file bugs

- Open an issue at the repo (link in `docs/README.md`).
- Include: the trace ID (Langfuse), the run ID (skill_run or workflow_run), and the `context_sha` from the run row. Those three pin down exactly what code + prompts produced the failure.
