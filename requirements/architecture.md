# Architecture

## System layers

```
                     ┌─────────────────────────────────────────────────────┐
                     │  Interfaces (channels)                              │
                     │  Web UI · MCP (stdio) · ChatGPT · Slack · Teams · A2A │
                     └─────────────────┬───────────────────────────────────┘
                                       │
                     ┌─────────────────▼───────────────────────────────────┐
                     │  Vocion Runtime                                │
                     │  (Next.js App Router · oRPC · Postgres · Drizzle)   │
                     │                                                     │
                     │  Auth (Clerk) · RBAC · Audit · Review queue         │
                     └──────┬────────────────┬──────────────┬──────────────┘
                            │                │              │
                  ┌─────────▼───────┐  ┌─────▼────┐  ┌─────▼──────────┐
                  │  Workspace-as-code│  │ Plugins  │  │  Workflows     │
                  │  agents/skills/ │  │ Skills + │  │  Sequential    │
                  │  object types/  │  │ Sources  │  │  steps + HITL  │
                  │  workflows      │  │ (npm)    │  │  approve gates │
                  │  YAML + MD      │  │          │  │                │
                  └─────────┬───────┘  └─────┬────┘  └─────┬──────────┘
                            │                │              │
                  ┌─────────▼────────────────▼──────────────▼──────────┐
                  │  Service layer (TypeScript)                        │
                  │  AgentService · SkillService · WorkflowService     │
                  │  BusinessObjectService · ReviewQueue               │
                  └────────────────┬─────────────────────────────┬─────┘
                                   │                             │
                       ┌───────────▼────────┐         ┌──────────▼─────────┐
                       │  Retrieval         │         │  LLM providers     │
                       │  Onyx today        │         │  OpenAI ✓          │
                       │  pgvector + FTS    │         │  Anthropic ✓       │
                       │  Vertex / Azure    │         │  Vertex (stub)     │
                       │  Search (planned)  │         │  Azure-OpenAI(stub)│
                       └────────────────────┘         └────────────────────┘
                                   │                             │
                       ┌───────────▼─────────────────────────────▼─────────┐
                       │  Observability (OpenTelemetry + Langfuse)         │
                       │  Spans · Metrics · LLM traces · Eval runs          │
                       └────────────────────────────────────────────────────┘
```

## Key architecture decisions

### Context as code (decided 2026-04-14, shipped Phase 1)

Every agent / skill / object type / workflow lives in `workspace/<org>/` as YAML + markdown. The DB stores runtime state (skill runs, drafts, approvals) only. `workspace:apply` is idempotent + records a `workspace_version` row stamped on every subsequent `skill_run`. Six months later you can answer "which prompt produced this output?" with one SQL join + a `git show <sha>`.

### Vocion owns the orchestration loop

The platform's runtime — agents, skills, workflows, review queue — is the product. Retrieval (Onyx today; pgvector next) is a tool, not the orchestrator. We do not build on top of vendor-managed agent frameworks (Vertex Agent Builder, Azure Foundry Prompt Flow); we wrap them as backends if customers need them.

### Skills are dual-path (decided 2026-04-14, shipped Phase 3 v0.1)

Skills come in two flavors:

- **Prompt skills** — YAML manifest + `prompt.md` template. Generic prompt runner interpolates and calls the LLM.
- **Plugin skills** — typed TypeScript modules implementing `Skill<Input, Output>`. Custom logic, multi-LLM-call, structured I/O.

If both exist for the same slug, the plugin wins. Same `skill_run` table, same review queue, same audit trail.

### Pluggable LLM provider (shipped Phase 3 v0.1)

Each plugin skill declares `provider: openai | anthropic | vertex | azure-openai`. The runtime resolves a `LLMClient` per skill at execution time. Switching providers is a one-line manifest change; the skill code is unchanged.

### Workflows are sequential + pause-resumable (shipped Phase 7 work, pulled forward)

Workflows compose skills with explicit `approve` gates. Step types: `skill`, `approve`, `action`. Triggers: `manual`, `event` (planned: `schedule`, `webhook`). Execution writes per-step state to `workflow_run.step_results`; on an approve step, the run pauses and any interface can resume it.

### Multi-channel by design

Skills, workflows, and the review queue are channel-agnostic. The same skill run started from Slack appears in the same review queue as one started in the web UI or via MCP from Claude Code. Adapters per channel (MCP shipped; ChatGPT/Slack/Teams/A2A queued) wrap the same service layer.

### Open core, self-host friendly

Apache 2.0 runtime. Postgres for state. Pluggable retrieval + LLM providers. No managed-only features in the core. MetaCTO Cloud (BSL → Apache after 4 years) and managed services exist alongside, never inside.

## Boundaries

| Concern | Where it lives |
|---|---|
| **What Vocion knows** (prompts, skill defs, agent personas, schemas) | `workspace/<org>/` — git, applied to DB |
| **What Vocion did** (skill runs, workflow runs, drafts, approvals) | DB — append-only, audit-trail-friendly |
| **Plugins** (typed code, packaged) | npm packages or local paths via `CORECONTEXT_PLUGINS` env |
| **Secrets** (OAuth tokens, API keys) | `.env` + secret managers — never in workspace-as-code |
| **Per-instance business data** (NINJIO Account row, specific discovery call) | DB business_object — runtime state, not config |

## What's out of scope (today)

- **Vendor agent frameworks as foundation** — Vertex Agent Builder, Foundry Prompt Flow. We wrap, don't depend.
- **Tool calling in the generic LLM interface** — provider-specific shape divergence. Plugins reach for `ctx.openai` directly when needed.
- **Plugin sandboxing** — plugins run in-process. v0.3 adds isolation for cloud-published third-party plugins.
- **Streaming inside workflow steps** — workflows are step-grained; intra-step streaming uses the LLM client directly.

See [`overview.md`](./overview.md) for product framing, [`tech-stack.md`](./tech-stack.md) for component choices, [`object-model.md`](./object-model.md) for the data model.
