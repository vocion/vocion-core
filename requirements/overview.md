# Product Overview

## What Vocion is

An open runtime for AI workflows that need to survive production. Versioned context, typed plugins, human review, full audit trail. Build once, run from Slack, Claude Code, ChatGPT, or your own app.

Apache 2.0. Self-hostable on Postgres. Pluggable retrieval and LLM provider. No forced cloud.

## What it is not

- Not a chatbot
- Not a managed-only SaaS
- Not vendor-locked to one model host or one retrieval backend
- Not a black box — every output traces back to the exact prompt version that produced it

## What the customer should feel

- "This knows our business"
- "I can review what it does before it does it"
- "I can explain any output, even six months later"
- "I can run this on my infrastructure"

## What the customer sees

Six clear surfaces, not infrastructure:

| Surface | Purpose |
|---|---|
| **Chat** | Conversational workspace powered by agents — answers, skill invocation, contextual actions |
| **Foundation** | The business-context layer — connectors, object types, objects, relationships, rules |
| **Skills** | Reusable, typed capabilities — query, mutation, composite |
| **Workflows** | Triggered sequences composing skills with explicit human-in-the-loop gates |
| **Review queue** | One queue for every pending decision — drafts, paused workflows |
| **Docs** | In-product reference for every primitive, plus authoring guides |

## The five planes

1. **Context plane** — connectors, retrieval, citations, search. Pluggable backend (Onyx today, pgvector + Postgres FTS native next).
2. **Business context model** — canonical object types + instances + relationships + business rules. Authored as YAML in `workspace/<org>/`, applied to DB.
3. **Execution plane** — skills (prompt-only or typed plugins), workflows (trigger → steps → action), agents (persona + scope).
4. **Control plane** — policies, RBAC, approval queue, audit trail (`workspace_version` SHA stamped on every `skill_run`).
5. **Improvement loop** — feedback per run, eval harness, prompt-improvement meta-skill (proposes PR-style diffs, never auto-applies).

## What an agent is in Vocion

An agent is a **packaged configuration**, not bespoke code. It lives in `workspace/<org>/agents/<slug>.yaml` plus a markdown system prompt.

| Component | What it is |
|---|---|
| `systemPrompt` | Identity, tone, rules, boundaries (markdown file) |
| `skills` | Slugs of skills this agent can invoke |
| `connectorSources` | Source types this agent can search |
| `objectTypes` | Business object types this agent can read/create |
| `searchConfig` | Recency decay, source weights, result limits |
| `fewShotExamples` | Quality + style anchors |
| `model` + `temperature` | LLM defaults |
| `approvalPolicy` | What requires HITL vs auto-run |

A user invocation:

1. Runtime loads the agent config from DB (synced from `workspace/<org>/agents/`)
2. Assembles system prompt + tool definitions scoped to the agent's skills/connectors/object types
3. Runs the agent loop with that config
4. Records the run in `skill_run`, stamped with `workspace_sha`
5. Traces to Langfuse if configured

**An agent is NOT:** a deployed microservice, a fine-tuned model, a special framework. Editing an agent is editing YAML + markdown. No code change, no deploy.

## What a skill is

Two flavors, same execution surface:

- **Prompt skill** — `workspace/<org>/skills/<slug>/skill.yaml` + `prompt.md`. Authored by humans (or the meta-agent). Templated `{{vars}}` interpolation, one LLM call.
- **Plugin skill** — TypeScript module exporting a typed `Skill<Input, Output>`. Authored by developers. Custom logic, multi-step pipelines, validated I/O via Zod.

If a plugin and a prompt skill share a slug, the plugin wins. Clean upgrade path: start with a prompt; promote to a plugin when logic outgrows it.

## What a workflow is

A YAML manifest at `workspace/<org>/workflows/<slug>/workflow.yaml`:

- **Trigger** — `manual`, `event` (planned: `schedule`, `webhook`)
- **Steps** — sequential. Step types: `skill`, `approve` (HITL pause), `action` (connector side effect)
- **Interpolation** — `{{input.x}}` / `{{steps.name.output.y}}` / `{{trigger.y}}`
- **Pause + resume** — `approve` step pauses the run; `runtime_resume_workflow` continues it from any interface

Every workflow run records per-step results, the active context SHA, and links back to the underlying skill runs.

## Audience split

Vocion is for developers, platform engineers, AI engineers, and technical founders who want leverage without losing control. The MetaCTO services arm exists for non-developer buyers who need someone to design + ship + run AI systems for them. They're complementary: Vocion is the runtime; MetaCTO is one (of many possible) implementation partner.

## Related

- [`tech-stack.md`](./tech-stack.md) — current stack + rationale
- [`architecture.md`](./architecture.md) — system layers + boundaries
- [`object-model.md`](./object-model.md) — first-class objects + their relationships
- [`skills.md`](./skills.md) — skill system design + types
- [`product-surfaces.md`](./product-surfaces.md) — UI surface specs
- [`rbac.md`](./rbac.md) — access control model
- [`/docs/`](../docs) — install guide, MCP reference, plugin SDK guide, workflow guide
