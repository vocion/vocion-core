# API

A tenant-scoped REST API for reading building blocks, ingesting objects, triggering runs, and polling results. Use this when you have an existing system that should push data into Vocion and/or consume results — without running an agent conversation and without speaking MCP.

## What's live today

Read endpoints are shipped and callable from any logged-in Clerk session. Bearer-token auth (`cmp_live_...`) ships with Phase 2.5.

| Status | Endpoint |
|---|---|
| ✓ live | `GET /api/v1/agents` · `/api/v1/agents/:slug` |
| ✓ live | `GET /api/v1/skills` · `/api/v1/skills/:slug` |
| ✓ live | `GET /api/v1/workflows` · `/api/v1/workflows/:slug` |
| ✓ live | `GET /api/v1/objects/types` |
| ✓ live | `GET /api/v1/runs/:id` |
| Phase 2.5 | All `POST` / `PATCH` / `DELETE` endpoints |
| Phase 2.5 | `cmp_live_...` Bearer tokens |
| Phase 2.5 | Webhooks + SSE streaming |

For now, authenticate using your Clerk session cookie (browser) or a Clerk session token (server). Everything scoped to your active Clerk organization.

## When to use the API vs MCP vs A2A

| Interface | When | Transport |
|---|---|---|
| **[MCP](../reference/mcp.md)** | You're an LLM-driven agent (Claude, Cursor, Zed) authoring + running inside a developer IDE | stdio (today), HTTP+OAuth (Phase 2) |
| **REST API** (this) | You're an external system or backend service that wants typed CRUD + run control | HTTPS + Bearer token |
| **A2A** | You're an agent speaking the A2A protocol and want to hand off tasks to a Vocion agent | HTTPS + capability discovery |

One workflow can be triggered from any of them; outputs land in the same `skill_run` / `workflow_run` tables and surface in the same review queue.

## Quickstart

```bash
# 1. Create an API token in the dashboard (Admin → API tokens)
export VOCION_TOKEN=cmp_live_...

# 2. List your agents
curl -H "Authorization: Bearer $VOCION_TOKEN" \
  https://your-vocion-install/api/v1/agents

# 3. Push a new object (e.g. a field-notes upload from a mobile app)
curl -X POST -H "Authorization: Bearer $VOCION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Site 4821 inspection","metadata":{"siteId":"4821","inspector":"mtorres"},"content":"..."}' \
  https://your-vocion-install/api/v1/objects/inspection/instances

# 4. Trigger the workflow it feeds
curl -X POST -H "Authorization: Bearer $VOCION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"input":{"objectId":"obj_123"}}' \
  https://your-vocion-install/api/v1/workflows/inspection_review/runs
# → { "runId": 987, "status": "running" }

# 5. Poll for the result
curl -H "Authorization: Bearer $VOCION_TOKEN" \
  https://your-vocion-install/api/v1/runs/987
# → { "status": "paused", "pausedAt": "review", "reviewUrl": "..." }
```

## Spec

- [Authentication](./authentication.md) — token issuing + rotation + scopes
- [Building blocks](./building blocks.md) — CRUD on Agent, Skill, Workflow, Object, Source
- [Runs](./runs.md) — triggering + polling + resume
- [Webhooks](./webhooks.md) — register URL + filter, receive completion events

## Principles

- **Tenant-scoped by default.** Every token belongs to one Clerk org; every request implicitly scoped to that org. Cross-tenant read/write is not possible.
- **Same building blocks everywhere.** The API surface mirrors the five concepts ([Source](../concepts/sources.md), [Object](../concepts/objects.md), [Skill](../concepts/skills.md), [Workflow](../concepts/workflows.md), [Agent](../concepts/agents.md)). If you understand the concepts, the API is already familiar.
- **Idempotency keys** on all POST endpoints. Replay-safe.
- **Versioned under `/api/v1`.** Breaking changes land under `/api/v2` with a deprecation window.
- **OpenAPI 3.1 spec** published at `/api/v1/openapi.json` — generate client SDKs with any tool that speaks OpenAPI.
