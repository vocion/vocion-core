# Tech Stack

Pragmatic choices for a Postgres-native, self-hostable AI runtime. No exotic dependencies; everything below runs on a laptop or any cloud.

## App + API

| Component | Choice | Why |
|---|---|---|
| **Framework** | Next.js 16 (App Router) + React 19 | Server components for fast SSR, single repo for marketing + dashboard, Turbopack dev loop |
| **Language** | TypeScript (strict) | Typed contracts across services, plugins, oRPC routes |
| **API layer** | oRPC | End-to-end type-safe RPC; thin adapter over service functions |
| **Auth** | Clerk | Multi-tenant orgs, OAuth, SSO/SAML for enterprise tier; replaceable |
| **Database** | PostgreSQL 16 | Single source of truth for runtime state. Migrations via Drizzle |
| **ORM** | Drizzle | Schema-first TS types, plain SQL when needed |
| **i18n** | next-intl | Server-component-friendly; Crowdin pipeline for translations |

## AI execution

| Component | Choice | Why |
|---|---|---|
| **LLM clients** | OpenAI SDK + Anthropic SDK | Direct provider clients per skill via the `LLMClient` adapter |
| **Plugin LLM provider** | `provider: openai \| anthropic \| vertex \| azure-openai` | Per-skill manifest field; vertex + azure are planned stubs |
| **Plugin contract** | `Skill<Input, Output>` (Zod-validated) | Typed I/O at the plugin boundary. v0.2 extracts to `@corecontext/sdk` |
| **Workflow runner** | In-process step runner on Postgres | One row per run; pause-resume on approve steps. Temporal adapter planned for scale-out |
| **Context-as-code** | YAML + markdown + Zod | Authored in repo, applied via idempotent reconcile job |

## Retrieval

| Component | Choice | Status |
|---|---|---|
| **Today** | Onyx (self-hosted, AGPL-adjacent) | Carryover from earlier MVP. Retrieval-only — Onyx's own agents and chat are unused |
| **Next** | pgvector + Postgres FTS + RRF | Native default. Reuses the Postgres we already run; zero new infra. |
| **Enterprise opt-in** | Vertex AI Search · Azure AI Search | Plugin backends behind the same `retrieval.yaml` config so customers on GCP / Azure can use managed retrieval without changing skills |

The platform abstracts retrieval behind `ctx.retrieve(query, opts)` so plugin skills don't see which backend is in play.

## Observability

| Component | Choice | Why |
|---|---|---|
| **LLM traces** | Langfuse | Open-source LLM observability. Optional — runtime degrades gracefully when unset |
| **Spans + metrics** | OpenTelemetry collector | Pluggable export to Honeycomb / Datadog / native Postgres tables |
| **Errors** | Sentry | Standard. Spotlight in dev for in-process capture |
| **App logs** | LogTape → stdout (default) or Better Stack (optional) | Structured logs, no vendor lock |
| **Audit trail** | `context_version` table + `skill_run.context_sha` | Every output traces back to the exact context snapshot that produced it |

## Infra

| Component | Choice | Why |
|---|---|---|
| **Container runtime** | Docker / Docker Compose for dev | Single `npm run dev:up` brings up app DB, Langfuse, Temporal, OTel collector, and Onyx |
| **Production target** | Any container orchestrator | Stateless app tier behind a load balancer; Postgres as durable state. Tested patterns: Fly, Railway, ECS, GKE, EKS |
| **Secrets** | `.env` for dev; vault / secrets manager for prod | Plugins reference via `${secrets.foo}` (Phase 2 wiring) |
| **CDN / static** | Whatever's in front of your app server | No special CDN requirements |

## Optional / planned

| Component | Choice | Status |
|---|---|---|
| **Workflow durability at scale** | Temporal | Adapter planned; in-process runner is the default until a customer needs it |
| **Stripe** | Stripe SDK | Wired but optional. Skip for non-billing deployments |
| **ChatGPT app** | OpenAPI Actions + listed GPT | Channel adapter planned alongside Slack/Teams |
| **Slack / Teams** | Bolt SDK / Bot Framework | Channel adapters planned |
| **Eval harness in CI** | Vitest fixtures + plugin evals | Per-plugin in v0.2 |

## What we explicitly didn't pick

- **LangChain / LangGraph** — too much abstraction over LLM calls; we want plain typed code in plugins. The runtime owns the orchestration loop.
- **Vendor agent frameworks** (Vertex Agent Builder, Azure Foundry Prompt Flow) — direct competitors to our orchestration layer. We wrap their *backends* (search, embeddings) but not their agent loops.
- **MongoDB / DynamoDB** — Postgres handles relational + JSON + vector + FTS in one engine. Adding a second store doesn't justify itself at our scale.
- **Kafka** — workflows are step-grained, not event-streaming-grained. Future event bus stays in Postgres NOTIFY/LISTEN until proven insufficient.

## Versions (current)

- Node ≥ 20 (recommended 22 LTS)
- PostgreSQL 16 or 17
- Docker Compose ≥ 2.20 (for `include:` directive in `docker-compose.yml`)

See [`architecture.md`](./architecture.md) for how these compose, [`/docs/self-hosted.md`](../docs/self-hosted.md) for the install guide, [`overview.md`](./overview.md) for product framing.
