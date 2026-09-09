# ADR 0002 — Architectural layers: Context / Execution / Interface

- **Status:** proposed
- **Date:** 2026-05-22
- **Owners:** Chris Fitkin
- **Related:** ADR 0001 (Agent runtime), Snowflake "Agent Context Layer" post (Mar 2026)

## Context

The codebase has accreted three implicit layers without crisp names:

1. Declarative authored artifacts in `context/<org>/` (agents, operations, playbooks, learnings, evals, workflows, objects), versioned via `context_sha`, applied via `context:check` / `context:apply`.
2. Runtime services that execute those artifacts: `AgentService`, `OperationService` (and lingering `SkillService`), `RetrievalService`, `WorkflowService`, `FeedbackWorkerService`, plus the deepagents runtime from ADR 0001.
3. Surfaces that expose execution to users and other agents: `src/app/[locale]/` (web UI), `src/interfaces/mcp/` (MCP server), `src/routers/*` mounted at `/rpc/*`.

Symptoms of the layers being unnamed:

- **"Operations" is overloaded.** It names both a `context/<org>/operations/` artifact type *and* the natural label for the runtime layer. `OperationService.ts` and `SkillService.ts` both exist — fallout from the v0.1 → v0.2 `skills/ → operations/` rename never finishing.
- **`src/interfaces/` is half-built.** The directory exists (so the concept is recognized) but only houses MCP; web UI lives in `src/app/` and the typed RPC surface in `src/routers/` by Next.js / oRPC convention.
- **`src/routers/` mixes layers.** It contains context CRUD (`Playbooks.ts`, `Learnings.ts`, `Evals.ts`, `BusinessObject.ts`) alongside execution endpoints (`Conversations.ts`, `Review.ts`) with no naming signal.
- **Cross-layer concerns have no home.** Phase 1/2 added authn/tenancy and `routers/AuthGuards.ts` became ad-hoc guards rather than part of a layer.

The Snowflake "Agent Context Layer" post (Mar 2026) prompted a re-examination. Their framing — analytic / relationship / playbook / provenance / event-memory / policy — maps reasonably onto what we have, but we lack internal vocabulary for our own layers.

## Decision

Adopt three layer names as the architectural vocabulary for the codebase:

**Context → Execution → Interface.** Mnemonic: **declared → executed → exposed.**

### Context (declared)

Authored, versioned, declarative artifacts. Lives in `context/<org>/` on disk; mirrored into the DB by `context:apply` and stamped with a `context_sha` on every run.

Artifact types:
- `agents/` — agent definitions (prompt, subagents, suggestions)
- `operations/` — typed LLM calls
- `playbooks/` — procedural guides (markdown + YAML)
- `learnings/` — accreted rules, whitelisted by step
- `evals/` — datasets per agent
- `workflows/` — sequential steps with approve gates
- `objects/` — business object type definitions
- `policies/` — *(new — see below)* entitlements and rule definitions

### Execution (executed)

Runtime services that load context and produce behavior. Currently `src/services/`. Includes the deepagents runtime (ADR 0001), retrieval, workflow orchestration, the feedback worker, and the agent runtime itself.

### Interface (exposed)

Surfaces through which users and other agents invoke execution: web UI, MCP server, typed RPC. Currently split across `src/app/[locale]/`, `src/interfaces/mcp/`, and `src/routers/*` (mounted at `/rpc/*`). This split is accepted (see decisions below).

### Policy belongs to Context

Policies are declarative rule definitions — same shape as everything else in `context/<org>/` (authored, versioned, validated by `context:check`). *Enforcement* is what cross-cuts: execution consults policy at run time; interface respects policy in what it exposes. Treat enforcement as a cross-cutting concern, not a fourth layer.

### Retrieval is the bridge

`RetrievalService` is the only legitimate cross-layer reader — it pulls context into the agent's working set at execution time. Document it as a bridge, not as a generic service.

## Decisions locked by this ADR

1. **Add `context/<org>/policies/`** as a recognized artifact type. Initial scope: rule definitions (who can do what). Schema and CRUD surface follow the existing pattern (`BusinessObjectService` / `routers/BusinessObject.ts` as the template). Runtime enforcement is deferred — adding the artifact type now is cheap and unblocks future work without forcing the enforcement design.

2. **Finish the `SkillService` → `OperationService` consolidation.** Delete `SkillService` once callers migrate. Independent of the rename but unblocked by having a clear vocabulary.

3. **Routers stay in `src/routers/`.** The router layer is part of **interface** — the RPC surface over context CRUD and execution alike. No move required; document the assignment. Splitting into `routers/context/` and `routers/execution/` was considered and rejected as ceremony.

4. **Do not move web UI into `src/interfaces/web/`.** Next.js's `app/` convention is load-bearing. Accept that interface surfaces live in three locations (`app/`, `interfaces/`, `routers/`) and document why.

5. **`RetrievalService` is the named bridge.** It is the one service permitted to read context for execution purposes. New code paths that need context at run time route through it rather than reading `context_*` tables directly.

## Consequences

### Positive
- Clear vocabulary when discussing the architecture externally (mirrors the Snowflake-style framing).
- "Operations" is no longer overloaded: the artifact type and the layer have distinct names.
- Policy has a home before we add it, rather than getting bolted on as guards.
- New contributors get a clean mental model: declared (context) → executed (execution) → exposed (interface).

### Negative / accepted tradeoffs
- Interface surfaces live in three directories (`app/`, `interfaces/`, `routers/`). Documented inconsistency rather than fought.
- "Execution" is slightly colder than "Operations" but unambiguous; "Runtime" was rejected because it already refers to the deepagents runtime specifically (ADR 0001).
- `SkillService` cleanup is a follow-up; this ADR doesn't itself land that change.

### Risks to watch
- "Policies as context" needs eval discipline: policy rules must be testable without standing up the full enforcement layer. Plan for this when designing the artifact schema.
- `routers/` will keep growing across context CRUD and execution endpoints. Revisit the no-split decision if the directory exceeds ~25 files or the mixed semantics start producing onboarding confusion.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Keep "Operations" as the runtime-layer name | Conflicts with `context/<org>/operations/`. Already causing service-naming confusion. |
| "Runtime" instead of "Execution" | "Runtime" already refers to the deepagents runtime specifically (ADR 0001). Layer-vs-component name collision. |
| Add Policy as a fourth top-level layer | Policy is *declared* (context-shaped) and *enforced* (cross-cutting). A separate layer duplicates context's authoring/versioning machinery for no gain. |
| Move web UI into `src/interfaces/web/` | Fights Next.js conventions for no real benefit. |
| Split `src/routers/` into `routers/context/` and `routers/execution/` | Ceremony. The router layer is uniformly an interface concern regardless of what it surfaces. |

## Implementation

This ADR records naming and the placement of policy. Follow-up work, separately scheduled:

- `context/<org>/policies/` artifact type: schema, loader, router CRUD, validation in `context:check`.
- `SkillService` removal once `OperationService` is the sole caller.
- Update top-level `CLAUDE.md` to reference Context / Execution / Interface once the policy artifact type lands (avoid documenting vocabulary ahead of code).
