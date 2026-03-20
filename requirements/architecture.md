# Architecture

## System Boundaries

```
Customer Browser / API Client
        │
        ▼
┌─────────────────────────────────┐
│  CoreContext API Layer          │  ← Product boundary
│  (Next.js App Router + oRPC)   │
│                                 │
│  Auth (Clerk) · RBAC · Audit   │
│  Feedback · Usage · Routing    │
└────────┬──────────┬────────────┘
         │          │
         ▼          ▼
┌────────────┐ ┌──────────────┐
│   Onyx     │ │  Temporal    │
│            │ │              │
│  Ingest    │ │  Workflows   │
│  Retrieve  │ │  Approvals   │
│  Search    │ │  Schedules   │
│  Agents    │ │  Retries     │
│  Actions   │ │  Events      │
│  Citations │ │  Long jobs   │
└────────────┘ └──────────────┘
         │          │
         ▼          ▼
┌────────────────────────────────┐
│  LangGraph                     │
│  Multi-step reasoning          │
│  Skill selection               │
│  Stateful runs                 │
│  Human-in-the-loop             │
└────────────────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│  Observability                 │
│  OpenTelemetry + Langfuse      │
│  Traces · Metrics · Evals     │
└────────────────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│  AWS Infrastructure            │
│  Compute · Storage · Secrets   │
│  Queues · Network              │
└────────────────────────────────┘
```

## Key Architecture Decisions

### CoreContext owns the agent orchestration loop (decided 2026-03-19)
- CoreContext's LLM agent is the "brain" — it decides what to do, what tools to call, what skills to run
- Onyx is demoted to a **retrieval tool** (`search_onyx`) — one capability among many, not the orchestrator
- Chat requests go to a **CC agent endpoint** that has tools: `search_onyx`, `run_skill`, `create_object`, `present_for_approval`
- This is the product differentiator: not better search, but understanding business context and taking action
- **Rejected alternative:** Onyx MCP server (makes CC a plugin to Onyx's agent loop, not a product)

### Implementation phases for the agent layer
1. **Sprint 2:** Simple CC router with tool calls — LLM with tools for search + skill execution (~100 lines)
2. **Sprint 3:** LangGraph for multi-step flows — discovery → summary → email → approve
3. **Sprint 4:** Temporal for scheduled/durable workflows — daily inbox scan, aging pipeline review

### Onyx is the retrieval substrate, not the product surface
- All client requests go through CoreContext API
- CoreContext API calls Onyx search/retrieval APIs as one tool among many
- Onyx can be swapped without customer-facing changes
- Onyx handles: document ingestion, chunking, embedding, hybrid search, citations
- CoreContext handles: agent reasoning, skill execution, object mapping, approval, observability

### Three permission layers
1. **Data visibility** - who can see which data
2. **Skill/action execution** - who can run which skills and actions
3. **Workflow approval** - who can approve which workflows

### Product-level RBAC in CoreContext, not Onyx
- Onyx RBAC is enterprise-gated and limited
- CoreContext maintains its own role/permission model
- Onyx permissions are a secondary enforcement layer, not primary

### Temporal for durability, LangGraph for reasoning
- Temporal handles the operational side: retries, schedules, approvals, long jobs
- LangGraph handles the cognitive side: multi-step reasoning, skill selection, memory
- They compose: a Temporal workflow step can invoke a LangGraph agent run

### Business object mapping lives in CoreContext
- Onyx indexes documents; CoreContext maps business reality
- Canonical objects (Account, Deal, Ticket, Project) span multiple source systems
- Object mapping is the primary differentiator

## Data Flow

### Chat Flow (agent-first)
1. User submits message via CoreContext Chat UI
2. CoreContext API authenticates, checks permissions
3. Message sent to **CC agent endpoint** — an LLM with tool definitions
4. Agent reasons about intent and calls tools as needed:
   - `search_onyx(query, filters)` — hybrid search over indexed documents
   - `run_skill(slug, input)` — execute a CC skill (e.g. discovery_summary, draft_followup)
   - `lookup_object(type, query)` — find business objects by type/metadata
   - `create_object(type, data)` — create a new business object with linked documents
   - `present_for_approval(content, type)` — queue output for human review
5. Each tool call is traced in Langfuse (input, output, latency, model)
6. Agent composes final response from tool results
7. Response streamed to user with evidence panel + skill outputs + approval actions
8. Logged to audit trail

### Action Flow
1. User triggers action from answer context or skill catalog
2. CoreContext API checks action permissions
3. If approval required, Temporal creates approval task
4. On approval (or if none needed), CoreContext calls Onyx action or direct API
5. Result logged to audit + run history
6. User notified of outcome

### Workflow Flow
1. Trigger fires (manual, scheduled, event-driven)
2. Temporal starts workflow execution
3. Each step may invoke LangGraph for reasoning or Onyx for retrieval/action
4. Human checkpoints pause for approval
5. Run history and status visible in UI
6. Completion triggers hooks/notifications
