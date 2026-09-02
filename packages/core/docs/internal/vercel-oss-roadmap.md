> **AMENDMENTS (2026-07-24, `dev` branch)** — this roadmap was grep-verified
> against a vocion-core that predates the July 22–24 `dev` work. Corrections
> before implementing:
>
> 1. **"Resumable + cancellable — nothing today" is half-stale.** CANCEL
>    exists (composer Stop → AbortController → clean finalize). The server
>    also keeps generating after a client drop and persists the turn
>    (reload rehydrates from Postgres, citations included) — crude resume.
>    TRUE mid-stream resumption is still absent; that part stands.
> 2. **The AgentEvent union is bigger than listed**: `trace_node` (the typed
>    hierarchical trace — reason/tool/skill/search/delegate/draft with actor
>    attribution + nesting) and `recommended_action` (A2UI cards) are now on
>    the wire, rendered (WorkTimeline, RecommendedActionCard/Stack), and
>    partially persisted (documents_json). The Phase B "maps ~1:1" table
>    must be redrawn against `services/agents/types.ts` on dev — trace_node
>    has NO stock AI SDK part; it would ride `data-*` custom parts.
> 3. **Sources/citations are richer now**: global citationIndex on
>    documents, inline [n] → drawer with Cited/All tabs, per-turn
>    persistence. Maps well to `source-document` parts + one custom field.
> 4. **A loop-control-ish seam already exists**: the recommendActionBackstop
>    (post-turn enforcement pass) — fold it into the Tier-1 prepareStep/
>    stopWhen design rather than keeping a bolt-on.
> 5. Sequencing stands: **Phase A + the Temporal patching audit (E) first**;
>    re-scope Phase B against dev before starting it.

# Vercel OSS Adoption & Capability Roadmap — Vocion Core

> **Branch:** `research/vercel-oss` (umbrella) · **Date:** 2026-07-24 · **Constraint:** stay self-hosted (AWS / Docker / Terraform)
>
> This roadmap combines two pieces of research into one plan:
> - **Track 1 — Adopt / partially adopt** the Vercel AI SDK and its UI streaming protocol, specifically to capture the **agent-UX and chat-streaming gains**.
> - **Track 2 — Capability harvest**: specific primitives and gaps mined from the AI SDK, Chat SDK, Eve, and the Workflow SDK, to build *in Vocion* (net-new / refactor / pattern-to-steal / audit).
>
> All deltas were grep-verified against `vocion-core`. Feature facts trace to the primary docs and the `vercel/ai`, `vercel/ai-chatbot`, `vercel/eve`, `vercel/workflow` repos (fetched July 2026). Companion visual artifacts: the decision report and the capability-harvest roadmap (URLs in the handoff appendix).

---

## 0. Decisions at a glance

| Subsystem | Verdict | Rationale (one line) |
|---|---|---|
| **LLM / model provider layer** | **Adopt AI SDK** | GA v7, Apache-2.0, framework-agnostic; collapses the dual `LLMClient`+LangChain layer; un-pins embeddings from the hardcoded OpenAI client. |
| **Chat surface / streaming wire** | **Partially adopt** | Replace the bespoke SSE `AgentEvent` format with the AI SDK UI data-stream — maps ~1:1. Harvest Chat SDK patterns; **do not fork** the template. |
| **Agent loop** | **Keep** deepagents/LangChain | Eve is filesystem-first with a build-time manifest — no runtime API for DB-driven per-org agents; beta, ~1mo old, Vercel-coupled. |
| **Workflow engine** | **Keep** Temporal | Workflow SDK's self-hosted Postgres World is a "reference implementation" and has **no native cron** — the feature Vocion's schedules rely on. |
| **Observability** | **Keep** Langfuse | Not a Vercel-OSS target; augment with OTel GenAI spans (Track 2). |
| **Vercel Connect** | **Out of scope** | Proprietary, per-request-billed, Vercel-bound — and *not* private networking (that's Secure Compute). Disqualified by the self-hosted constraint. |

**Licensing:** all four OSS libs are **Apache-2.0** (permissive, patent grant, trivial NOTICE obligation). Current deps are MIT except `openai` (Apache-2.0). No copyleft anywhere. Real risks are *beta churn* (Eve, WDK) and *lock-in* (Connect), not license terms.

---

## Track 1 — Adopt AI SDK + its UI protocol: the streaming & agent-UX foundation

**Why this is the anchor:** adopting the AI SDK as the model layer (net-new dependency — it's not in the tree today) and its **SSE UI data-stream protocol** for the chat surface is what unlocks the agent-UX and streaming gains below. The protocol's typed parts map almost 1:1 onto Vocion's hand-rolled `AgentEvent` union, so this is a migration, not a rewrite.

**Current state (verified):**
- Dual provider layer: `libs/llm/registry.ts` (neutral `LLMClient`) + `libs/llm/langchain.ts` (`buildChatModel(role)`, roles main/classifier/embedder).
- Embeddings hard-pinned to OpenAI: `libs/retrieval/embedder.ts:24` (`text-embedding-3-small`), `:34` (`new OpenAI()`).
- Chat: bespoke SSE at `app/[locale]/rpc/agent/stream/route.ts` (`sendEvent` :169); `AgentEvent` union mirrored in `services/agents/types.ts:44` and `agent-runtime/src/contract.ts:48`. Variants: `thinking`, `thinking_delta`, `tool_start`, `tool_end`, `subagent_start`, `subagent_end`, `answering`, `response_delta`, `documents`, `retrieval_progress`, `skill_result`, `hitl_gate`, `done`, `error`, `usage`.
- Client reducer: `features/dashboard/chat/ChatShell.tsx`.

**The gains (what "adopt" buys, mapped to AI SDK primitives):**

| Gain | AI SDK primitive | Maps onto Vocion's… |
|---|---|---|
| **Resumable + cancellable streams** | resumable-stream + `activeStreamId`; `consumeStream`; dedicated `/stop` endpoint | *nothing today* — stream dies on refresh/drop/timeout |
| **Typed, schema-validated wire** | `UIMessage.parts[]`, `data-*` parts, **transient** parts, `validateUIMessages()` | the bespoke `AgentEvent` SSE union |
| **Reasoning panel, model-agnostic** | `reasoning-*` parts + `extractReasoningMiddleware` | `thinking` / `thinking_delta` + ThinkingPanel |
| **Tool breadcrumbs, streamed live** | `tool-input-start/delta/available`, `tool-output-available` | `tool_start` / `tool_end` + ToolBreadcrumb |
| **HITL as typed protocol part** | `tool-approval-request/response`, `addToolApprovalResponse`, auto-resume | `hitl_gate` + HitlGate |
| **Sources panel** | `source-url` / `source-document` parts | `documents` + SourcesPanel |
| **Generative UI registry** | `tool-<name>` part → React component, 4-state lifecycle | ad-hoc breadcrumb rendering |
| **Streamed, versioned artifacts** | `createDocumentHandler({kind,...})` + streamed deltas | the `create_artifact` tool |
| **Provider-swappable embeddings** | `embed()` / `embedMany()` w/ `text-embedding-3-small` | OpenAI-pinned `embedder.ts` |
| **Native tool loop + structured output** | `stopWhen: stepCountIs(n)`, `ToolLoopAgent`, `Output.object/array` | the deepagents loop (see Track 2 for the loop itself) |

**Scope boundary:** this migrates the **model layer** and the **chat wire/UX**, keeping the Drizzle message store, NextAuth, and the deepagents agent loop untouched. Chat SDK is read as a pattern source (artifacts, persistence), **not** forked.

---

## Track 2 — Capability harvest (build in Vocion; don't adopt frameworks wholesale)

Tags: **[NEW]** net-new · **[REFACTOR]** upgrade of something you have · **[PATTERN]** steal the design, keep the engine · **[AUDIT]** check the codebase.

### Tier 1 — Agent-runtime robustness (highest leverage, all net-new)
- **[NEW] Loop-control seam — `prepareStep` + `stopWhen` + `activeTools`** (AI SDK). Per-iteration model/tool/context rewriting; composable, testable stop conditions; per-step tool gating. *Vocion:* one deepagents loop, ad-hoc termination, all ~13 tools exposed every turn. *Payoff:* model escalation, cost control, tool-selection accuracy as data, not forked code. Seam: `services/agents/harness.ts`, `AgentService.ts` (`runAgentDeep`).
- **[NEW] Context compaction** — `pruneMessages` (AI SDK) / `compaction.thresholdPercent` (Eve). *Vocion:* **none** (only `fetchUrl.ts` output truncation). *Payoff:* fixes long-run context bloat → cost/latency/quality collapse.
- **[NEW] Tool-call repair** — `experimental_repairToolCall` (AI SDK). Re-ask/coerce on invalid tool calls instead of killing the turn. *Payoff:* fewer dead turns across 13 structured-arg tools.
- **[NEW] Mid-turn message injection** (WDK step-boundary drain). Interrupt-and-redirect a running agent. *Vocion:* `interrupts` are HITL gates only, not injection. *Payoff:* hard-to-retrofit UX; reserve a step-boundary injection point now.

### Tier 2 — Streaming & resumption (the biggest reliability gap)
- **[NEW] Resumable + cancellable streams** (AI SDK / WDK). *(Also the anchor of Track 1.)* Persist chunks, reconnect from the drop point (snap to nearest part-start), keep generating server-side after disconnect, and truly cancel via a race-safe `/stop`. Seam: `rpc/agent/stream/route.ts`.
- **[REFACTOR] Typed, schema-validated stream protocol** (AI SDK). *(Also Track 1.)* Replaces the hand-parsed `AgentEvent` union; transient-vs-persisted explicit; schema drift caught on load. Seam: `services/agents/types.ts` + `agent-runtime/src/contract.ts`.

### Tier 3 — Integration & multi-tenant surface (net-new, unlocks use cases)
- **[NEW] MCP *client* + tool-drift detection** (AI SDK). Consume external MCP tool servers; `fingerprintTools()`/`detectToolDrift()` flag unauthorized schema mutations. *Vocion:* exposes an MCP **server** (`app/api/mcp/route.ts`) but is not a client. *Payoff:* fixed toolset → open integration surface; drift-detect is a rare prompt-injection defense.
- **[NEW] Connections + mid-turn per-user OAuth** (Eve). Auth declared separately from tools with `app` vs `user` principal; a user token triggers a durable OAuth-consent pause that auto-retries the same call. *Payoff:* act on a **customer's own** Gmail/CRM, not just a shared app credential.
- **[NEW] Sandbox adapter interface** (Eve). One adapter with tiered fallback (hosted → Docker → microsandbox → just-bash), `bootstrap()` (cached) vs `onSession()` split, persistent `/workspace`. *Vocion:* a `run_code` tool, no isolation. *Payoff:* mature blueprint for safe code execution.
- **[NEW] Channels contract** (Eve). A channel normalizes input, owns the `continuationToken`, and decides delivery. *Vocion:* web/API only; Slack/Gmail are *search sources*, not chat surfaces. *Payoff:* define this seam before Slack/email/SMS so each is an adapter, not a pipeline fork.

### Tier 4 — Refactors + a cross-cutting middleware layer
- **[NEW] Model middleware layer — `wrapLanguageModel`** (AI SDK). `transformParams`/`wrapGenerate`/`wrapStream` for caching, PII redaction, guardrails, logging, RAG injection as stackable layers. *Vocion:* concerns sprinkled through call sites. Seam: `libs/llm/*`.
- **[REFACTOR] Tool-level predicate HITL approval** (Eve / AI SDK). Argument-aware approval (`approve if amount > 500`) in the ordinary chat loop, not just at the workflow level. *Vocion:* binary `harness.interrupts` gate. *Payoff:* fewer needless prompts; gate only high-risk calls.
- **[REFACTOR] Skills = progressive-disclosure procedures** (Eve). Expose only descriptions + a `load_skill` tool; append full markdown on demand. *Vocion:* playbooks/learnings as a virtual FS. *Payoff:* library scales without inflating every turn's tokens; per-tenant variants via a dynamic key.
- **[REFACTOR] Provider registry + aliases + reasoning middleware** (AI SDK). Semantic model roles (`fast`/`reasoning`) + fallback provider for failover; `extractReasoningMiddleware` for model-agnostic reasoning. *Vocion:* role-based `buildChatModel` + `BudgetService` caps already exist. *Payoff:* provider failover + tenant-tier model routing.

### Tier 5 — Durability patterns to steal (keep Temporal, borrow ergonomics)
- **[PATTERN] Typed hooks + token namespacing + non-blocking `getConflict()`** (WDK). Schema-validated suspension keyed by deterministic tokens; claim-check without blocking. *Vocion:* Temporal `approval` signals lack schema + dedup. *Payoff:* solves "which paused run does this inbound event belong to?"
- **[PATTERN] Auto-minted run-scoped webhook URLs** (WDK). `createWebhook()` for click-to-approve / external-resume with zero route wiring.
- **[PATTERN] Deterministic memory-write hook** (Eve). Fires *after* durable persistence, observe-only; persist facts on `message.completed`. *Vocion:* AgentCore Memory writes are model-discretionary today. *Payoff:* reliable long-term memory (Vocion is otherwise ahead here — Eve ships no memory layer).
- **[PATTERN] Session-as-workflow chat modeling** (WDK). One long-lived run = the session; input via a hook. *Vocion:* stateless-per-turn (`toHistoryTurns` re-reads Postgres each message). *Payoff:* whole-session traces "for free"; fits multi-day HITL.

### Tier 6 — Cheap ops wins & one real audit
- **[NEW] Headless run inspection with deep-links** (WDK `workflow inspect --url`). Paste a run/step link into a PR/incident thread. *Payoff:* thin wrapper over Temporal APIs; shorter debug loop.
- **[REFACTOR] OTel GenAI span conventions + privacy toggles** (AI SDK). Standardized spans (`invoke_agent`→`chat`→`execute_tool`) with `recordInputs:false`. *Vocion:* Langfuse + custom callback. *Payoff:* vendor-neutral schema (Langfuse ingests OTel) + PII switch + per-tool spans.
- **[AUDIT] Temporal patching / versioning discipline.** Grep found **no `patched()` / worker-versioning** usage in `services/temporal/workflows/`. *Risk:* replay-diverged-from-history — acute for multi-day HITL pauses and crons. *Action:* adopt patching discipline before workflows grow.

---

## Sequenced roadmap

**Phase A — AI SDK as the model layer** *(low risk, high value)*
Replace `libs/llm/*` behind the existing interface; migrate `embedder.ts` off the hardcoded OpenAI client to `embed()`. Add the provider registry + fallback + `wrapLanguageModel` middleware seam (Tier 4) while you're in there. Rollback = old adapters behind a flag.

**Phase B — Chat wire → AI SDK UI data-stream** *(the UX/streaming payoff; medium risk, incremental)*
Map each `AgentEvent` variant to a protocol part; adopt `useChat` + resumable/cancellable streams (Tier 2); land the typed schema-validated protocol, generative-UI registry, typed HITL approval, and streamed document-handler artifacts. Keep the Drizzle store + NextAuth. Run the new route alongside `/rpc/agent/stream` behind a flag until parity.

**Phase C — Agent-runtime robustness** *(Tier 1)*
Introduce the loop-control seam (`prepareStep`/`stopWhen`/`activeTools`), context compaction, and tool-call repair on the existing deepagents loop (or evaluate AI SDK `ToolLoopAgent` as a lighter alternative on one agent).

**Phase D — Integration surface & durability patterns** *(Tiers 3 & 5, as product needs pull them)*
MCP client, connections + per-user OAuth, sandbox adapter, channels contract; typed hooks / webhook URLs / deterministic memory-write hook on top of Temporal.

**Phase E — Ops & audit** *(Tier 6, can run anytime)*
OTel spans, CLI deep-links, and the **Temporal patching audit** (do this early — it's cheap and de-risks everything else).

**Explicitly parked:** Eve migration · Vercel Connect · Workflow SDK cron / full Temporal replacement · forking the Chat SDK template.

---

## Confidence & caveats
- Deltas grep-verified in `vocion-core` where it changed a recommendation: compaction (absent), Temporal patching (absent), MCP direction (server not client), `interrupts` semantics, channels (search-sources only), `BudgetService` (present).
- The two "keep" verdicts were adversarially verified: WDK cron is RFC-stage (Discussions #66, #1649); Eve's no-runtime-agent-definition-API is evidence-of-absence across docs. A few Eve API names (evals, agent-config) come from concept docs whose deep pages 404'd — treat exact signatures as approximate.

---

## Sources (primary, fetched July 2026)
- **AI SDK:** ai-sdk.dev/docs (loop-control, ai-sdk-core, ai-sdk-ui/stream-protocol, embeddings, middleware, telemetry, mcp-tools), vercel.com/blog/ai-sdk-7, github.com/vercel/ai (LICENSE = Apache-2.0), github.com/vercel/ai-chatbot (`lib/artifacts/server.ts`).
- **Workflow SDK:** workflow-sdk.dev/docs (hooks, human-in-the-loop, resumable-streams, observability), /worlds/postgres, github.com/vercel/workflow (`packages/world-postgres/README` — "reference implementation"), Discussions #66 & #1649 (cron RFC).
- **Eve:** eve.dev/docs (tools, connections, skills, channels, sandbox, subagents, agent-config), vercel.com/docs/eve/concepts, vercel.com/blog/introducing-eve, github.com/vercel/eve (LICENSE = Apache-2.0).
- **Vercel Connect:** vercel.com/docs/connect (proprietary, per-request billed, beta).

---

## Appendix — Paste-ready handoff for another Claude Code instance

```
CONTEXT HANDOFF — Vercel OSS roadmap for Vocion Core

Repo: /private/var/www/vocion-local (umbrella; submodules vocion-core, vocion-demos, vocion-www).
Branch: research/vercel-oss (umbrella only; NO submodule code was changed — vocion-core is on its own pin).
Working tree: modified .gitignore + vocion-core pin (pre-existing, unrelated); new file VERCEL-OSS-ROADMAP.md (this plan). Nothing committed yet.
Full plan: read /private/var/www/vocion-local/VERCEL-OSS-ROADMAP.md.
Companion artifacts (read-only, on claude.ai):
  - Decision report: https://claude.ai/code/artifact/2543f25f-2081-43a0-ad24-6996b7351c2c
  - Capability harvest: https://claude.ai/code/artifact/3f05f20c-37b5-486b-bd42-a689784420b5
Research notes: /private/tmp/.../scratchpad/vercel-oss-research-notes.md (session scratchpad; may be gone — the roadmap md supersedes it).

CONSTRAINT: stay self-hosted (AWS/Docker/Terraform). No Vercel-platform-bound features.

DECISIONS (verified, opinionated):
- ADOPT Vercel AI SDK (v7, Apache-2.0, framework-agnostic) as the model/provider layer. Not a dependency today = clean adoption.
- PARTIALLY ADOPT the AI SDK UI data-stream (SSE) protocol for the chat surface — it maps ~1:1 to Vocion's bespoke AgentEvent union. Harvest Chat SDK patterns; DO NOT fork the template.
- KEEP Temporal (WDK has no native cron — RFC-stage; Vocion relies on cron Schedules).
- KEEP deepagents/LangChain agent loop (Eve is filesystem-first w/ build-time manifest — no runtime API for Vocion's DB-driven per-org agents; beta + Vercel-coupled).
- KEEP Langfuse. Vercel Connect OUT (proprietary/paid/Vercel-bound; not private networking).

KEY SEAM FILES (in vocion-core/packages/core/src unless noted):
- libs/llm/{registry,langchain}.ts  — provider layer to migrate to AI SDK
- libs/retrieval/embedder.ts:24,34   — OpenAI-pinned embeddings → embed()
- app/[locale]/rpc/agent/stream/route.ts (sendEvent:169) — SSE chat endpoint to migrate to UI protocol
- services/agents/types.ts:44 + packages/agent-runtime/src/contract.ts:48 — mirrored AgentEvent union
- features/dashboard/chat/ChatShell.tsx — client stream reducer
- services/agents/harness.ts, AgentService.ts (runAgentDeep) — deepagents loop (add loop-control seam)
- services/temporal/workflows/ — AUDIT: no patched()/versioning discipline found (replay-divergence risk)

PRIORITIZED NEXT MOVES:
1. Phase A: AI SDK model layer + provider registry/fallback + wrapLanguageModel middleware seam; un-pin embeddings.
2. Phase B: chat wire → AI SDK UI protocol; resumable/cancellable streams; typed schema-validated parts; generative-UI registry; typed HITL approval; streamed document-handler artifacts. (This is the UX/streaming payoff.)
3. Phase C: loop-control (prepareStep/stopWhen/activeTools) + context compaction + tool-call repair on the deepagents loop.
4. Cheap+early: Temporal patching audit (Phase E).
Parked: Eve, Vercel Connect, WDK cron/Temporal replacement, forking Chat SDK.

VERIFIED DELTAS: no context compaction exists; no Temporal patching; Vocion is MCP server (not client); BudgetService already enforces token/$ caps; Slack/Gmail are search-sources not chat channels; chat is stateless-per-turn (toHistoryTurns).
```
