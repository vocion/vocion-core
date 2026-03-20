# CoreContext

**Enterprise context platform that turns your company knowledge into a usable AI system.**

CoreContext connects your systems, maps your business objects, and gives your team answers they can act on — with governed skills, approval workflows, and continuous improvement.

## Architecture

```
┌─────────────────────────────────────────┐
│  CoreContext — Product Boundary          │
│  Auth · RBAC · Audit · Agents · Skills  │
└────────┬──────────┬─────────────────────┘
         │          │
    ┌────▼────┐ ┌───▼──────┐
    │  Onyx   │ │ Temporal  │
    │ Search  │ │ Workflows │
    └─────────┘ └──────────┘
         │
    ┌────▼────────────────┐
    │  Langfuse            │
    │  Observability       │
    └──────────────────────┘
```

**CoreContext owns the agent orchestration loop.** Onyx is the retrieval substrate. Temporal handles durable workflows. Langfuse provides observability.

## Three Layers

| Layer | Purpose | Pages |
|-------|---------|-------|
| **Context** | What the system knows — connectors, objects, business rules | Domains, Objects, Connectors |
| **Intelligence** | How the system thinks — skills, agents, workflows | Skills, Agents (Ziggy), Workflows |
| **Control** | How it improves — evals, observability, tuning | Evals, Langfuse, System Status |

## Tech Stack

- **Framework:** Next.js 16, React 19, TypeScript
- **Context Engine:** Onyx (self-hosted, Docker)
- **Agent LLM:** GPT-5.4 (tool calling, streaming)
- **Skills LLM:** GPT-5.4-mini
- **Database:** PostgreSQL + Drizzle ORM
- **Auth:** Clerk (multi-tenant, RBAC)
- **Payments:** Stripe
- **Observability:** Langfuse
- **Workflows:** Temporal
- **Search:** Vespa (via Onyx)

## Getting Started

```bash
npm install
cp .env.example .env.local   # Fill in API keys
npm run dev                   # Start dev server + PGLite
```

### Start Onyx (Context Engine)
```bash
./infra/onyx/setup.sh
cd infra/onyx/onyx-repo/deployment/docker_compose
docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.override.yml -p onyx-stack up -d
```

### Start Platform Services (Langfuse + Temporal)
```bash
docker compose -f infra/docker-compose.platform.yml up -d
```

### Run Evals
```bash
npx tsx src/scripts/run-evals.ts
```

## Ports

| Service | Port | URL |
|---------|------|-----|
| CoreContext | 3000 | http://localhost:3000 |
| Onyx UI | 3100 | http://localhost:3100 |
| Onyx API | 8080 | http://localhost:8080 |
| Langfuse | 3200 | http://localhost:3200 |
| Temporal UI | 8233 | http://localhost:8233 |

## Case Study: Ziggy (Sales Ops Agent)

Ziggy is the first packaged agent on CoreContext, dogfooding MetaCTO's own sales operations.

**What Ziggy does:**
- Finds and classifies discovery calls from Zoom transcripts
- Generates structured summaries with prospect, budget, timeline, and next steps
- Drafts capabilities follow-up emails
- Searches across HubSpot, Gmail, Zoom, and Google Drive

## Roadmap

### Platform — Built

- [x] Agent system (tool calling, streaming, Langfuse tracing)
- [x] Skill execution engine (prompt interpolation, run tracking)
- [x] Business object model (types, instances, document links)
- [x] Knowledge domains (hierarchy explorer)
- [x] Zoom connector enrichment (call classification, summaries)
- [x] Chat UX (citation popovers, thinking steps, source sidebar)
- [x] System status dashboard
- [x] Eval runner (12/12 passing)

### Platform — Next

- [ ] Contextual action menus on business objects
- [ ] Real-time OpenAI streaming for final response
- [ ] Skill execution from Chat results
- [ ] Multi-agent support (agent picker from DB)
- [ ] Workflow execution (Temporal-backed)

### Enterprise — Planned

- [ ] **Document-level RBAC** — per-document and per-source access control enforced at search and agent layers
- [ ] **Self-service OAuth** — users connect their own Gmail, HubSpot, DocuSign, Calendly accounts with managed token refresh
- [ ] **SSO / SAML** — enterprise single sign-on
- [ ] **Audit trail** — every query, skill run, and approval logged with user context
- [ ] **Tenant isolation** — strict data separation between organizations at DB and search levels
- [ ] **Data residency** — configurable region for storage and processing
- [ ] **Compliance controls** — PII detection, retention policies, data export
- [ ] **Role-based skill access** — restrict skills and actions by role
- [ ] **Multi-step approval workflows** — approval chains with escalation and delegation
- [ ] **Custom embedding models** — BYOM or fine-tune on domain data
- [ ] **Connector marketplace** — guided OAuth setup with permission mapping
- [ ] **Usage analytics** — per-user, per-agent cost attribution and tracking
- [ ] **Prompt governance** — versioning, change approval, rollback, A/B testing
- [ ] **Automated evals** — scheduled runs with regression alerts
- [ ] **API access** — REST/GraphQL for programmatic agent interaction
- [ ] **Webhooks** — inbound/outbound for event-driven workflows
- [ ] **White-label** — custom branding, domain, theming per tenant

## Conventional Commits

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation |
| `refactor` | Code change (no feature/fix) |
| `test` | Tests |
| `chore` | Build/tooling |

## License

Proprietary — MetaCTO, Inc.
