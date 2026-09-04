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

Write path: `services/IngestionService.ingestDocument()` — chunks via `libs/retrieval/chunker.ts` (512 tokens, 64 overlap), embeds via `libs/retrieval/embedder.ts`, upserts into the chunk + document tables in a single transaction.

Embeddings run on OpenAI `text-embedding-3-small` by default and on Amazon Bedrock Titan when a workspace or the environment says so — `libs/retrieval/embeddingBackend.ts` owns the vendor specifics, the embedder owns batching, retry and tracing. Provider precedence: `project.embeddingConfig` (authored as `defaults.embeddingProvider` in `workspace.yaml`), then `VOCION_EMBEDDING_PROVIDER`, then `VOCION_LLM_PROVIDER`, then OpenAI. The `embedding` column is `vector(1536)`, fixed in the DDL — every backend checks the width it got back and refuses a mismatch rather than failing at insert, because storing a different width needs a schema migration plus a re-embed of every chunk. Titan G1 (`amazon.titan-embed-text-v1`) does return 1536, verified with a live `InvokeModel` on 2026-09-03; AWS's own docs contradict each other on this, so trust the check, not the docs.

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

../workspace/              # Git-backed client context — OUTSIDE this repo,
└── <org>/                 # at the peer level of the checkout ($WORKSPACE_PATH)
    ├── agents/            # YAML — slug, prompt, subagents, suggestions
    ├── operations/        # v0.2: renamed from skills/. Typed LLM calls.
    ├── playbooks/         # v0.2: markdown + YAML procedural guides
    ├── learnings/         # v0.2: whitelisted rule-step buckets
    ├── evals/             # v0.2: eval datasets per agent
    ├── workflows/         # YAML — sequential steps with approve gates
    └── objects/           # YAML — business object type definitions
```

## Context as Code

Every authored resource lives in a workspace — a git-backed directory of YAML + markdown that sits **outside this repo** (usually `../workspace/<org>/`, beside the checkout) — never hardcoded in TS. The app locates it via the `WORKSPACE_PATH` env var; unset means no workspace is configured (reads show empty state, applies/writes error explicitly).

```bash
npm run workspace:scaffold -- <name>              # create ../workspace/<name> (peer of this checkout)
npm run workspace:check -- <path>                 # validate + diff
npm run workspace:apply -- <path> --project <id>  # sync to DB; records a workspace_version row
```

Every operation run + agent run + eval run stamps the active `workspace_sha` so you can trace any output back to the exact prompts that produced it. See `docs/workspace.md` for authoring.

## Agent runtime (v0.2)

Agents run on **LangChain.js + `deepagents@1.10`**. The runtime gives you subagents (declared per-agent in YAML), a per-request virtual filesystem mounting playbooks at `/playbooks/<slug>/` and rendered learnings at `/learnings/<step>.md`, built-in `write_todos` + filesystem tools, and SSE streaming with 15s keepalives. See [`docs/internal/adr/0001-langchain-deepagents.md`](./docs/internal/adr/0001-langchain-deepagents.md).

Opt in by setting `VOCION_AGENT_RUNTIME=deepagents` and pointing the chat at `/rpc/agent/stream`. Default model: `claude-sonnet-4-6` (main) + `claude-haiku-4-5-20251001` (classifier). Override per-role via `VOCION_LLM_MODEL_MAIN` etc.

## BYOA agent runtime (harness provider `runtime`)

The same deepagents loop also ships as a standalone artifact — **`packages/agent-runtime`** — with the BYOA HTTP contract (`POST /invocations` SSE + `GET /ping`), hostable on a laptop or AWS Bedrock AgentCore Runtime (same bundle). Three execution layers now share one event contract, selected per agent via `harness.provider` in workspace YAML (`local` | `agentcore` | `runtime`) or fleet-wide via `VOCION_AGENT_PROVIDER`:

- The artifact is **generic**: agent definitions travel in the invocation payload (compiled from the agent row per request), so `workspace:apply` stays a DB sync and agent edits never redeploy anything.
- **Tools execute in core**, not the artifact: catalog entries POST back to `/api/internal/agent-tools` with a signed `TenantClaim` (`services/agents/claims.ts`) — orgId/user ACLs come only from the verified claim (`services/agents/toolEndpoint.ts`; cross-tenant test suite in `toolEndpoint.test.ts`). Single tool registry: `services/agents/tools/registry.ts`.
- Core targets the artifact via `VOCION_AGENT_RUNTIME_ARN` (deployed, SigV4) or `VOCION_AGENT_RUNTIME_URL` (local HTTP, default `:8080`). Budget charging rides `usage` events back from the artifact.
- **Cutover status**: `sales-assistant` runs on `provider: runtime` (workspace YAML). Dev therefore needs the artifact running — `npm run dev:agent-runtime` (:8080) — or set `VOCION_DISABLE_RUNTIME=1` to force the in-process loop (symmetric to `VOCION_DISABLE_AGENTCORE`).
- **AgentCore Memory (Phase 5, live)**: when `VOCION_AGENTCORE_MEMORY_ID` is set (core = flag only; the artifact needs it plus AWS creds), runtime-provider conversations with a persisted `conversation_id` get a Memory session (`vocion-conv-<id>-<org>`); the loop loads history from Memory and appends each completed turn (`packages/agent-runtime/src/memory.ts`). Default is belt-and-suspenders — payload history still rides along and the richer source wins; `VOCION_MEMORY_AUTHORITATIVE=1` omits payload history (verified live: turn answered from Memory alone). Postgres stays the system of record for the UI; Memory failures degrade silently to payload history.
- **Long-term memory (live)**: the store runs two extraction strategies — `vocion_facts` (semantic) + `vocion_preferences` — namespaced `/facts/{actorId}` and `/preferences/{actorId}`. Each turn, the loop retrieves relevant records for the actor and injects them as a context preamble, so recall crosses conversations (verified live: a preference stated in one conversation was recalled in a brand-new one ~50s later, post-extraction). Strategies are provisioned idempotently by `infra/agentcore/provision.sh`.
- Infra: `infra/agentcore/{provision,deploy-runtime,smoke-invoke}.sh` (ENV=dev, profile `metacto`, us-west-2). E2E: `src/scripts/smoke-runtime.ts` (`--provider` to force a specific provider). CI deploy: `.github/workflows/deploy-agent-runtime.yml` — inert until `provision-ci-role.sh` is run and `AWS_DEPLOY_ROLE_ARN` is set as a repo secret (deliberate human step: it creates GitHub↔AWS federated trust). See `packages/agent-runtime/README.md`.

## Background worker

The comment-feedback loop ships as a separate process (Next.js doesn't host long-lived workers):

```bash
ENABLE_FEEDBACK_WORKER=1 npm run worker:serve
# or
docker compose --profile worker up -d
```

Opt-in via the env flag. Drains `feedback_job` rows queued by Drive webhooks, classifies via Haiku, and writes the classification back. A classification that proposes rule text becomes a **learning candidate** — a suggestion in a queue, never an applied rule. A person adopts or rejects it at `/dashboard/learnings` or over `/api/v1/learning-candidates`; the worker never commits a learning itself.

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

## API credentials and which key an outbound call spends

Two different things share the `api_token` table, told apart by a `platform`
column, kept from mixing by the `api_token_shape_ck` CHECK constraint and kept
from crossing over afterwards by the `api_token_platform_immutable_tg` trigger
(`platform` cannot be updated; revoke and re-insert instead):

- **Minted** (`platform = 'vocion'`) — a `vcn_live_<id>_<secret>` Bearer token
  an outside caller presents *to* Vocion. Its SHA-256 is stored for
  authentication, plus the whole token AES-256-GCM encrypted under the org's DEK
  so an admin can show and copy it again from the dashboard. Tokens issued
  before that landed have the hash only and can never be shown again.
- **Supplied** (every other platform) — the key a workspace holds *with* a
  vendor, AES-256-GCM encrypted under that org's DEK so we can read it back and
  call out with it. One live key per platform per org, enforced by a partial
  unique index; saving a second revokes the first in the same transaction.

`src/libs/platforms/registry.ts` is the only list of platforms. Adding one is a
descriptor there — nothing in the service, router or UI enumerates them.

**Every outbound vendor call resolves its key the same way: the org's stored key
first, the server's env var second.** Reach for the helper, never
`process.env.<VENDOR>_API_KEY` directly:

- `buildChatModelForOrg(role, orgId, opts)` — LangChain chat models.
- `getLLMClientForOrg(provider, orgId)` — the provider-neutral `LLMClient`.
- `resolveOrgProviderKey(provider, orgId)` (`libs/llm/orgKey.ts`) — the raw key,
  for a call site that constructs its own SDK client. Returns null when the org
  supplied none; fall back to the env var then, do not fail.
- `resolveToolProviderKey(provider, orgId)` (`libs/tools/orgKey.ts`) — the same
  answer for a built-in tool provider (`tavily`, `brave`, `firecrawl`, and
  `openai` for image generation). `hasToolProviderKey(provider, orgId)` answers
  the readiness question the Tools catalog asks without decrypting anything.
  A tool provider reads the org off `opts.orgId`, so every tool that calls one
  has to hand its org down — `webSearch`, `fetchUrl`, `crawlSite` and their MCP
  twins in `interfaces/mcp/tools/capability-tools.ts` all do.

**Amazon Bedrock is the exception to "the key is one string."** Its credential
is an AWS access key pair, stored under the `aws` platform, so
`resolveOrgProviderKey('bedrock', …)` deliberately returns null — handing back
field one would hand back the access key id, which authenticates nothing. Use
`resolveBedrockCredentials(orgId)` (`libs/llm/bedrockCredentials.ts`), which
returns `{ source: 'org' | 'environment', keyPair }`. A null `keyPair` means
"leave the AWS SDK's credential chain in charge" — the only route by which
`AWS_BEARER_TOKEN_BEDROCK` or a host's instance role can sign the call, so never
substitute an empty pair for it.

Bedrock is also the one AWS call site allowed the platform-identity fallback
that `resolveAwsCredentials` refuses by default, and the reason is narrow:
`InvokeModel` on a foundation model reads and writes no Vocion resource, so the
blast radius is that we pay for the tokens — the same exposure OpenAI and
Anthropic already have. Anything touching KMS, AgentCore or a deploy role still
goes through `resolveAwsCredentials` with the fallback off.

**Per-agent vendor, per-workspace embeddings.** `harness.modelProvider` in agent
YAML (`anthropic` | `openai` | `bedrock`) picks the vendor for one agent's chat
model — a different axis from `harness.provider`, which picks where the loop
executes. Embeddings are **not** per-agent: `defaults.embeddingProvider` /
`defaults.embeddingModel` in `workspace.yaml` land on `project.embeddingConfig`
and apply workspace-wide. That asymmetry is deliberate. A query vector is only
comparable to vectors produced by the same model, so an agent embedding queries
on a different provider from the one that ingested the documents would degrade
search with no error anywhere.

Already wired: the five chat-model call sites, `libs/retrieval/embedder.ts`,
`libs/retrieval/reranker.ts`, `services/agents/tools/kitVision.ts`,
`libs/tools/image/openai.ts`, and the paid tool providers
`libs/tools/websearch/{tavily,brave}.ts` + `libs/tools/browse/firecrawl.ts`.
Deliberately still on the server's key, because no org is in scope where they
run: `DiscoveryDetectionService` and `services/feedback/classifier.ts`.

**Never cache a client keyed on anything less than the exact key in use.** A
per-provider singleton hands the first org's key to every org after it. Build
per call — the constructor is nothing next to the HTTP round trip, and a
rotated or revoked key then takes effect on the next call with nothing to
invalidate. Any new outbound path gets a test that runs two orgs in sequence and
asserts each got its own key.

**Only `CredentialValidationError` may reach a client.** Those messages are
authored in the platform registry and name no secret. Any other failure carries
whatever text the database or the vault produced; log it and return something
generic.

Supplied keys never take a Vocion-side expiry — the vendor owns the lifetime.

Encryption at rest is `VOCION_CREDENTIAL_VAULT`: `local` (wrapping key in
`VOCION_CREDENTIAL_VAULT_KEY`, same database as the wrapped key — development
only) or `kms` (AWS KMS under `VOCION_KMS_KEY_ARN`).

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

- **Structural over prompting.** When a model behavior is a REQUIREMENT (cards
  must emit, raw data must never dump, events must be typed), do not iterate
  system-prompt wording — prompt once, and if the behavior is still
  inconsistent, enforce it in code. Levers in order of strength: typed
  contracts/events the UI consumes, deterministic post-processing, a gated
  backstop LLM pass that fires only on violation (see
  `harnessConfig.recommendActionBackstop` in AgentService), recency reminders
  inside tool outputs (weakest). Prove behavior with a harness/E2E run —
  "the prompt says so" is not evidence. (Proven: 3 prompt iterations failed
  to restore action cards; the backstop guaranteed them. Same story for the
  `<scratch>` strip and the typed trace.)
- Conventional Commits (enforced by commitlint + lefthook)
- ESLint with Antfu config
- Strict TypeScript
- T3 Env for validated environment variables
- All translations in `src/locales/` - developers maintain `en.json`
