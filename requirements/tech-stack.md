# Technology Stack

## Stack Layers

### 1. Context Layer: Onyx

**Role:** Context engine (ingestion, retrieval, search, agent runtime, action plumbing)

Use Onyx for:
- Ingestion and sync (40+ source connectors)
- Retrieval and grounded answers
- Search with source/time/author/tag filtering
- Built-in agent runtime
- Action plumbing into external systems (OpenAPI + MCP)
- Citations and evidence retrieval

Onyx capabilities leveraged:
- Custom actions through OpenAPI and MCP
- Shared auth or per-user auth for actions
- Agents shared to org or specific users/groups
- Hybrid search and knowledge-based retrieval
- Connector refresh and prune settings

Onyx limitations to build around:
- Permission-syncing connectors are limited and enterprise-gated
- RBAC for agents/actions/documents is enterprise-gated
- Analytics/query history are enterprise-gated
- User-scoped tokens listed as "coming soon"
- Workflows listed as "coming soon"

### 2. API Layer: CoreContext API (Next.js)

**Role:** Product boundary — all client integrations hit this, not Onyx directly

Endpoints:
- `/ask` - Conversational queries
- `/search` - Search with filters
- `/objects` - Business object CRUD
- `/skills` - Skill catalog and execution
- `/actions/run` - Action execution
- `/workflows/run` - Workflow execution
- `/runs` - Run history
- `/feedback` - Feedback collection
- `/admin/connectors` - Connector management
- `/admin/policies` - Policy management
- `/admin/mappings` - Object mapping management

Benefits of own API layer:
- Keeps Onyx swappable
- Enforces own permissions, audit, usage plans, business logic
- Product-level RBAC independent of Onyx licensing tier

### 3. Orchestration: Temporal

**Role:** Durable, operational workflows

Use for:
- Approvals
- Retries
- Long-running jobs
- Scheduled jobs
- Event-driven automations
- Handoffs between humans and agents

Rationale: Crash-proof execution that resumes after failures or outages.

### 4. Agent Logic: LangGraph

**Role:** Multi-step reasoning and stateful agent runs

Use for:
- Multi-step reasoning
- Choosing among skills
- Stateful runs
- Pause/resume
- Human review in the middle
- Memory across the session

Rationale: Low-level orchestration for long-running, stateful agents with durable execution, memory, streaming, and human-in-the-loop.

### 5. Observability: OpenTelemetry + Langfuse

**OpenTelemetry** (base telemetry):
- Traces
- Metrics
- Logs

**Langfuse** (LLM-specific):
- LLM traces
- Prompt/version tracking
- Evals
- Annotations
- Latency/cost monitoring
- Dataset creation from bad runs

### 6. Infrastructure: AWS

Use AWS for:
- Compute
- Storage
- Secrets
- Queues
- Network control

Onyx supports Docker, Kubernetes, Terraform on AWS.

Rule: Do not let AWS managed AI products become the customer-visible product boundary.

## Customer-Facing App Stack

- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript
- **Styling:** Tailwind CSS 4 + Shadcn UI
- **Auth:** Clerk (multi-tenancy via organizations, RBAC)
- **Database:** PostgreSQL + Drizzle ORM
- **Payments:** Stripe (subscriptions)
- **i18n:** next-intl
