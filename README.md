# CoreContext

**The open delivery OS for AI workflows.** CoreContext turns a messy business process into a measurable AI operating system — context as code, skills as plugins, review surfaces built in.

---

## Vision

Every serious AI engagement produces the same five artifacts (workflow blueprint, context map, economics baseline, live review surface, launch scorecard). Today those artifacts live in slide decks, Notion pages, and bespoke code. CoreContext is the runtime where they live natively — so every engagement ships the same deliverables, every client gets a reviewable audit trail, and every workflow improvement compounds across the install base.

Three bets:

1. **Context belongs in git, not a database.** Business objects, prompts, workflow blueprints, retrieval tuning — all versioned markdown/YAML. The DB holds runtime state (skill runs, drafts, approvals) only.
2. **Skills and sources are plugins.** A published SDK with typed contracts means a partner can ship a HubSpot connector or a proposal skill without touching core.
3. **Open core beats closed product.** MetaCTO's moat is the operating model and the install base, not the code. OSS core accelerates adoption; managed cloud + implementation is the revenue engine.

---

## Product Strategy

**Position:** the delivery OS for AI workflows. Same category shape as Dagster (data orchestration), Temporal (durable workflows), Langfuse (LLM ops) — OSS runtime, commercial cloud, services on top.

**Buyer experience:** one validated workflow, one review surface, a clear expansion path. Platform handles the plumbing (context, retrieval, skills, review UI, evals, observability, reporting) so every engagement can spend its weeks on workflow design and change management, not infrastructure.

**Moats:**

- Methodology encoded in the platform (5 artifacts = platform primitives)
- Plugin ecosystem (network effect on connectors + skills)
- Monthly review becomes a generated report, not billable hours
- Client context repo = portable deliverable the client actually owns

**Economic model:**

| Tier | What | Pricing |
|---|---|---|
| OSS | Core runtime + core plugins | Free (Apache 2.0) |
| Cloud | Hosted CoreContext, managed Postgres/pgvector, evals-as-a-service, auto-scale | $/workflow-run + $/seat |
| Implementation | MetaCTO engagements (Sprint → Continuous Ops) | $45K sprints → $15K/mo retainer |
| Private plugins | Client-specific connectors, proprietary skills | Engagement or license |

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Client Context Repo (git, per-client)                         │
│  business-objects/  skills/  prompts/  retrieval.yaml  evals/  │
└──────────────────────────────┬─────────────────────────────────┘
                               │ apply / read-through
┌──────────────────────────────▼─────────────────────────────────┐
│  CoreContext Runtime (Apache 2.0)                              │
│  Agent loop · Skill engine · Review UI · Plugin SDK · Auth     │
│  Retrieval pipeline (pgvector + FTS + RRF, config-driven)      │
└─────┬──────────────────┬──────────────────┬───────────────────┘
      │                  │                  │
  ┌───▼────┐       ┌─────▼──────┐     ┌─────▼──────┐
  │ Core   │       │ Client     │     │ Runtime    │
  │ Plugins│       │ Plugins    │     │ State (PG) │
  │ (OSS)  │       │ (private)  │     │ skill_runs │
  └────────┘       └────────────┘     └────────────┘
```

### Four tiers of code and data

| Tier | Location | Content | Versioning |
|---|---|---|---|
| **Core** | `corecontext/core` (OSS) | Agent orchestrator, skill runtime, review UI, plugin SDK, retrieval pipeline, business-object model, skill_run persistence, auth, multi-tenant | semver |
| **Core plugins** | `@corecontext/plugin-*` (OSS) | Zoom, Slack, HubSpot, Apollo, Gmail, Drive, proposal-to-Gamma, research, summarize | independent semver |
| **Client plugins** | `@clientname/plugin-*` (private) | Proprietary connectors, custom skills, client-specific UI overrides | semver |
| **Client context** | `client-*-context` git repo | Business objects, domains, prompts, workflow blueprints, retrieval config, eval fixtures, economics baseline, plugin enablement | git SHA |
| **Runtime state** | Platform Postgres | skill_run history, drafts, approvals, user activity, feedback | append-only, immutable |

**Rule:** if a second client would use it, it's core. If the client owns it, it's context. If it's proprietary IP, it's a private plugin. Runtime state is never in git.

---

## Plugin Model

A plugin is an npm package that exports a manifest. Core loads manifests at boot and registers skills and sources via a typed contract. Plugins run sandboxed with a scoped context (tenant, secrets, retrieval client, db client).

### Skill contract

```ts
export const proposalSkill: Skill = {
  id: 'proposal.generate',
  version: '1.0.0',
  input: z.object({ objectId: z.string(), style: z.enum(['standard', 'deep']) }),
  output: z.object({ draftId: z.string(), gammaUrl: z.string().optional() }),
  async run(ctx, input) { /* ... */ },
  review: ProposalReviewCard, // React component for human-in-loop
  evals: [/* fixtures + expected outputs */],
};
```

### Source contract

```ts
export const hubspotSource: Source = {
  id: 'hubspot',
  version: '1.0.0',
  auth: { type: 'oauth2', scopes: ['contacts.read', 'deals.read'] },
  async fetch(ctx, cursor) { /* ... */ },
  transform(raw) { /* → documents + business_objects */ },
  retrieval: { /* defaults, overridable by client context */ },
};
```

### Plugin enablement (client context)

```yaml
# client-context/plugins.yaml
sources:
  - id: hubspot
    version: ^1.0.0
    config:
      portal_id: ${secrets.hubspot_portal_id}
  - id: zoom
    version: ^1.0.0

skills:
  - id: proposal.generate
    version: ^1.0.0
    input_defaults:
      style: deep
```

---

## Retrieval as Config (replaces Onyx)

**Today:** Onyx — 12-container stack (Vespa, OpenSearch, Redis, multiple Postgres, embedding models, indexing workers). Heavy, opaque, AGPL-adjacent, hard to tune per client.

**Target:** Postgres-native retrieval with a config-driven pipeline. Everything MIT / Apache / PostgreSQL-licensed. Drops from 12 containers to **zero new infra** (reuses the Postgres we already run).

### Stack

| Concern | Component | License |
|---|---|---|
| Vector store | `pgvector` | PostgreSQL |
| Keyword search | Postgres FTS (`tsvector` + GIN) | PostgreSQL |
| Hybrid ranking | Reciprocal rank fusion (SQL) | — |
| Embedding | Pluggable (OpenAI, Voyage, Cohere, Ollama, vLLM) | API / Apache |
| Reranker | Pluggable (Voyage, Cohere, bge local) | API / Apache |
| Chunking | `@corecontext/chunker` (recursive, semantic, fixed) | Apache 2.0 |
| Ingestion | Plugin sources → normalized `Document` shape | Apache 2.0 |

### Config (client context)

```yaml
# client-context/retrieval.yaml
embedder:
  provider: openai
  model: text-embedding-3-large
  dimensions: 3072
  batch_size: 96

chunking:
  strategy: recursive
  size: 1200
  overlap: 200
  respect_boundaries: [heading, paragraph]

vector:
  store: pgvector
  index: hnsw
  m: 16
  ef_construction: 64
  ef_search: 80

keyword:
  store: postgres_fts
  language: english
  boost_fields: {title: 2.0, body: 1.0}

hybrid:
  method: rrf
  k_constant: 60
  vector_weight: 1.0
  keyword_weight: 0.6

rerank:
  enabled: true
  provider: voyage
  model: rerank-2
  top_n_input: 40
  top_n_output: 8

query:
  k_nearest: 8
  similarity_threshold: 0.3
  max_context_tokens: 8000

# Per-source overrides
overrides:
  sources:
    zoom:
      chunking: {size: 2000, overlap: 300} # longer transcripts
      rerank: {top_n_output: 4}
  domains:
    sales:
      embedder: {model: text-embedding-3-small} # cost optimization
```

Every skill_run persists the retrieval config SHA and hit set, so "why did the agent retrieve X on March 3rd" is answerable six months later.

---

## Observability, Reporting, Measurement

All three feed from one event stream.

- **Events:** skills and sources emit typed spans + domain events (`skill.started`, `retrieval.completed`, `draft.approved`, `draft.rejected`, etc.)
- **Transport:** OpenTelemetry → your backend of choice (Langfuse, Honeycomb, Datadog, or Postgres tables for OSS default)
- **Economics instrumentation:** every skill_run records `baseline_cost_usd`, `assisted_time_seconds`, `approval_outcome` — makes the monthly Launch Scorecard a SQL query, not a deck-building exercise
- **Git SHA linkage:** every skill_run stores `context_sha` + plugin versions — full audit trail
- **Auto-generated deliverables:** Context Map PDF, Workflow Blueprint, Launch Scorecard all generate from `client-context/` + runtime tables. The 5 standard artifacts are byproducts, not billable hours.

---

## Roadmap

Phased to preserve MetaCTO revenue at every step; nothing ships that breaks live client work.

### Phase 1 — Context-as-Code (Q2 2026)

Pull hardcoded client data out of the app. Everything MetaCTO-specific moves to a `metacto-context` repo.

- [ ] `client-context/` repo scaffold + schema
- [ ] Apply/reconcile job: repo → DB on push
- [ ] Read-through mode for prompts + business rules (dev loop)
- [ ] `context_sha` column on `skill_run`
- [ ] Move MetaCTO (Ziggy) context to its own repo; dogfood
- [ ] Docs: authoring guide + templating

**Exit criteria:** MetaCTO/Ziggy runs entirely from git-backed context. No client-specific strings in core.

### Phase 2 — Plugin SDK v1 (Q3 2026)

Extract skills and sources from the monorepo into the plugin contract.

- [ ] `@corecontext/sdk` package: Skill, Source, manifest, sandbox
- [ ] Migrate existing skills (proposal, enrichment, summarize) to plugins
- [ ] Migrate connectors (Zoom, Gmail, Drive, HubSpot) to Source plugins
- [ ] Plugin hot-reload in dev, semver resolution in prod
- [ ] Eval harness runs plugin evals on CI for every PR

**Exit criteria:** a partner can publish a skill or source without a core PR.

### Phase 3 — Native Retrieval (Q4 2026)

Replace Onyx with the pgvector-native pipeline.

- [ ] pgvector schema + HNSW index
- [ ] Postgres FTS layer
- [ ] RRF hybrid ranker
- [ ] Pluggable embedder + reranker interfaces + default implementations
- [ ] `retrieval.yaml` config, per-source/per-domain overrides
- [ ] Migration tool: existing Onyx index → pgvector
- [ ] Deprecate Onyx containers; doc migration path for existing deployments

**Exit criteria:** zero Onyx dependency in new deployments; feature parity on search quality; measured cost drop.

### Phase 4 — Auto-Generated Deliverables (Q1 2027)

Turn the 5 standard artifacts into platform output.

- [ ] Workflow Blueprint generator (renders from `workflows/*.md`)
- [ ] Context Map PDF export
- [ ] Economics Baseline dashboard from skill_run aggregates
- [ ] Launch Scorecard (monthly) — SQL + templated deck, exports to Gamma
- [ ] Monthly Review runner (computes the 6-section agenda automatically)

**Exit criteria:** a MetaCTO ops lead generates the monthly review deck with one click.

### Phase 5 — OSS Launch + MetaCTO Cloud (Q2 2027)

- [ ] Public repo + Apache 2.0 license
- [ ] Docs site, getting-started, contributor guide
- [ ] MetaCTO Cloud beta: hosted Postgres + pgvector, managed evals, SSO
- [ ] Reference installs: 3 external clients running OSS in production
- [ ] Launch blog + conference talk

**Exit criteria:** OSS stars trending; first non-MetaCTO contributor PR merged; first paid cloud customer.

### Phase 6 — Ecosystem + Enterprise (Q3 2027+)

- [ ] Plugin marketplace (listings, signing, permission scopes)
- [ ] SSO/SAML, SCIM, audit export, data residency regions
- [ ] Document-level RBAC at retrieval + agent layers
- [ ] Role-based skill access + multi-step approval chains
- [ ] Community plugin incentives (bounties for top connectors)

---

## Licensing

**Open core. Permissive.** The runtime is free; cloud operation and bespoke IP are commercial.

| Artifact | License | Rationale |
|---|---|---|
| CoreContext core (runtime, SDK, review UI) | **Apache 2.0** | Patent grant matters for enterprise adoption; wide community adoption (Dagster, Langchain, Hugging Face precedent) |
| Core plugins (Zoom, HubSpot, proposal, etc.) | **Apache 2.0** | Same rationale; encourages forks and customization |
| MetaCTO Cloud control plane | **BSL 1.1 → Apache 2.0 after 4 years** | Prevents hyperscaler from hosting competitive SaaS while the market forms; auto-converts to Apache for long-term trust |
| Client plugins (proprietary connectors, custom skills) | **Commercial** (per-engagement or license) | Client or MetaCTO IP |
| Client context repos | **Owned by client** | Portable deliverable; MetaCTO has write access under engagement |
| MetaCTO methodology docs (ECE Wiki, playbooks) | **CC BY-NC 4.0** or proprietary | Brand/IP protection without preventing public reference |

**Trademark:** "CoreContext" and MetaCTO logos held by MetaCTO, Inc. Forks must rebrand.

---

## What We Use Today That Gets Replaced

| Today | Problem | Replacement | When |
|---|---|---|---|
| Onyx (AGPL-ish, 12 containers, opaque tuning) | Heavy, license-adjacent, hard to customize per client | pgvector + Postgres FTS + RRF + pluggable embed/rerank | Phase 3 |
| Hardcoded prompts in TS files | Not reviewable, no version history, client-specific strings in core | `client-context/prompts/*.md` with git history | Phase 1 |
| Business objects seeded via migration scripts | Opaque, coupled to schema changes, no per-client variance | `client-context/business-objects/*.yaml` applied at boot | Phase 1 |
| Skills as imports in app code | Can't be shipped by third parties, hot-reload impossible | Plugin SDK with manifest + sandbox | Phase 2 |
| Langfuse (external SaaS) as only observability | Lock-in; not OSS-compatible by default | OpenTelemetry → pluggable backend (Langfuse/Honeycomb/Postgres) | Phase 3 |
| Temporal (heavy for our scale) | Over-provisioned for current workflow complexity | In-process durable step runner on Postgres; Temporal adapter for scale-out | Phase 4 |

---

## Getting Started

```bash
npm install
cp .env.example .env.local       # Fill in API keys
docker compose up -d postgres    # Postgres 16 + pgvector
npm run db:migrate
npm run dev:next                 # http://localhost:3000
```

### Run evals

```bash
npx tsx src/scripts/run-evals.ts
```

### Apply client context (Phase 1+)

```bash
CONTEXT_REPO=../metacto-context npm run context:apply
```

---

## Tech Stack (current)

- **Framework:** Next.js 16, React 19, TypeScript
- **Database:** PostgreSQL + Drizzle ORM
- **Auth:** Clerk (multi-tenant, RBAC)
- **Agent LLM:** GPT-5.4 (tool calling, streaming)
- **Skills LLM:** GPT-5.4-mini
- **Retrieval (today):** Onyx → (Phase 3) pgvector + Postgres FTS
- **Observability (today):** Langfuse → (Phase 3) OpenTelemetry
- **Workflows (today):** Temporal → (Phase 4) pluggable durable step runner

---

## Ports

| Service | Port | URL |
|---|---|---|
| CoreContext | 3000 | http://localhost:3000 |
| Postgres | 5432 | — |
| Onyx UI (deprecating) | 3100 | http://localhost:3100 |
| Langfuse (optional) | 3200 | http://localhost:3200 |

---

## Case Study: Ziggy (Sales Ops Agent)

Ziggy is the first packaged agent on CoreContext, dogfooding MetaCTO's own sales operations. It also drives the platform roadmap — Phase 1's context-repo work starts with extracting MetaCTO's context from the app into `metacto-context/`.

**What Ziggy does:**
- Finds and classifies discovery calls from Zoom transcripts
- Generates structured summaries with prospect, budget, timeline, next steps
- Drafts capabilities follow-up emails and proposal decks (Gamma)
- Searches across HubSpot, Gmail, Zoom, Google Drive

---

## Conventional Commits

| Type | Description |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation |
| `refactor` | Code change (no feature/fix) |
| `test` | Tests |
| `chore` | Build/tooling |

---

## License

Currently proprietary — MetaCTO, Inc. Relicensing to Apache 2.0 targeted for Phase 5 (Q2 2027).
