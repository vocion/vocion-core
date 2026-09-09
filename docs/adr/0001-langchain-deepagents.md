# ADR 0001 — Agent runtime: LangChain.js + deepagents

- **Status:** accepted
- **Date:** 2026-05-11
- **Owners:** Chris Fitkin
- **Supersedes:** the hand-rolled OpenAI tool loop in `src/services/AgentService.ts`
- **Related plan:** `/Users/chrisfitkin/.claude/plans/reactive-sleeping-micali.md`

## Context

The current `AgentService.ts` (864 lines) is a hand-rolled tool-calling loop over `openai.chat.completions.create`. It works but is OpenAI-only, capped at 5 iterations, has no subagents, no virtual filesystem, no `write_todos` middleware, and no SSE keepalives — features that the internal rev-ai project (`/var/www/metacto/spinutech/kickoff-demo`) demonstrates are decisive for a usable agent experience.

We need a runtime that:

1. Supports first-class **subagent dispatch** (rev-ai's `task("name", "...")` pattern).
2. Mounts a per-request **virtual filesystem** so playbooks (markdown + YAML) and rendered learnings (`/learnings/<step>.md`) can be exposed to the model as files it reads on demand.
3. Streams **per-token deltas + tool-start/tool-end events** in a way the chat UI can render as inline breadcrumbs.
4. Lets us swap models per role (`main` = Claude Sonnet 4.6, `classifier` = Haiku 4.5) without grep-replacing IDs across services.
5. Plugs cleanly into Langfuse for observability.

## Decision

Adopt **LangChain.js + [`deepagents@1.10.1`](https://github.com/langchain-ai/deepagentsjs)** as the agent runtime.

Verified surface in `dist/index.d.ts`:

- `createDeepAgent({ model, tools, subagents, skills, backend, middleware })`
- `SubAgent` type
- `StateBackend`, `StoreBackend`, `FilesystemBackend`, `CompositeBackend`, `LocalShellBackend`
- `createSkillsMiddleware`, `createSubAgentMiddleware`, `createSummarizationMiddleware`, `createMemoryMiddleware`, `createCompletionCallbackMiddleware`
- `createAsyncSubAgentMiddleware` (out-of-band subagent runs — not used in Phase 4, but available for Phase 6+)
- Filesystem tool names: `ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`, `execute`
- `listSkills`, `parseSkillMetadata` — directly reusable in our Playbook loader (Phase 3)

Streaming via `agent.streamEvents(input, { version: 'v3' })`. **This is a deepagents JS-specific API that returns a `DeepAgentRunStream` with projection-based AsyncIterables** — `run.messages`, `run.toolCalls`, `run.subagents`, `run.middleware`, `run.values`, `run.output`. Each `run.messages` item exposes a `.text` AsyncIterable of token strings; each `run.toolCalls` item has `.input`, `.output` (Promise), `.status`. This is **strictly better than rev-ai's raw `astream_events("v2")` filter** because the projections are first-class typed surfaces rather than a flat tagged-union event stream. The Phase 4 SSE adapter therefore consumes `run.messages` / `run.toolCalls` / `run.subagents` in parallel and maps them onto the chat UI's existing `AgentEvent` shape — simpler than rev-ai's `_RunCollector` + tag-switch pattern.

## Decisions locked by this ADR

1. **Default models** (set in Phase 1's `buildChatModel` factory):
   - `main` → `claude-sonnet-4-6` (prompt cache enabled where supported).
   - `classifier` → `claude-haiku-4-5-20251001`.
   - OpenAI provider remains available behind the role registry but is no longer the hardcoded default anywhere in `AgentService`.

2. **Streaming wire format**: switch the chat route from newline-delimited JSON to **true SSE** (`text/event-stream`). 15-second keepalive comment lines (`: keepalive\n\n`) defeat proxy idle drops (Tailscale Funnel, Cloudflare, mobile carriers, iOS Safari). Implementation pattern ports from `/var/www/metacto/spinutech/kickoff-demo/server/main.py:1285-1379` (multiplex agent events + timer into one queue, flush whichever fires first).

3. **No LangGraph checkpointer**. Conversation history is replayed from `conversation_message.runs_json` per turn (matches rev-ai's explicit design choice in `server/conversations.py:14-17`). The agent's virtual FS (todos, files) is rebuilt fresh each turn from `initialFiles`. If we later need persistent agent memory across turns, swap `StateBackend` for `StoreBackend` (Postgres-backed) — defer until forced by a use case.

4. **Background workers** (introduced in Phase 6 for the comment-feedback loop): a separate `worker:serve` Node process is required. Next.js / Vercel cannot host long-lived poll loops. The worker is added as a `docker-compose` sidecar and is **opt-in via `ENABLE_FEEDBACK_WORKER=1`** so the agent itself runs without it. At-least-once delivery via Postgres `FOR UPDATE SKIP LOCKED`.

5. **Tool schemas**: all agent tools are LangChain `tool()` with **Zod** parameter schemas. The current `AgentService.ts` builds OpenAI JSON Schema tools — every one of those tool definitions is ported to Zod in Phase 4.

6. **Langfuse**: as of 2026-05-11, `langfuse-langchain@3.38.20` (latest) still peer-pins `langchain@>=0.0.157 <0.4.0` — it has not been updated to support LangChain v1. We therefore **do not install `langfuse-langchain`**. Instead, Phase 1 ships a thin `BaseCallbackHandler` adapter in `src/libs/Langfuse.ts` that wraps the existing `langfuse@^3` core SDK (`langfuse.trace`, `trace.generation`, `trace.span`) onto LangChain's callback events (`handleChatModelStart/End`, `handleToolStart/End`, `handleChainStart/End`). Same trace shape, no peer-conflict.

## Consequences

### Positive
- Subagent dispatch, FS tools, `write_todos`, skills middleware all "for free" from deepagents — we don't reinvent them.
- Multi-provider through `ChatAnthropic` / `ChatOpenAI` becomes the default, not a special case.
- Streaming events surface enough information for the chat UI to render the inline tool breadcrumbs rev-ai's UI has.
- Langfuse callback plugs in idiomatically.
- `listSkills` and `parseSkillMetadata` from deepagents are directly reusable by our Phase 3 Playbook loader — fewer custom helpers.

### Negative / accepted tradeoffs
- New deps add ~10MB to the install: `@langchain/core`, `@langchain/anthropic`, `@langchain/langgraph`, `langchain`, `deepagents`. (`langfuse-langchain` is NOT installed — see decision 6.) Peer `langsmith` (optional, only required for sandbox features we don't use).
- `@langchain/langgraph@^1.3` and `langchain@^1.4` are recent (Oct/Nov 2025). Surface area may shift; pin to specific minor versions and bump intentionally. Several ecosystem packages (notably `langfuse-langchain`) have not yet caught up to LangChain v1 — expect to write small adapter shims for v0.x-only integrations until they catch up.
- `StateBackend` does not persist FS across turns. Todos a user names in turn 1 are not visible in turn 2 unless we replay them via the system prompt or upgrade to `StoreBackend`. Accepted for parity with rev-ai's intentional design.
- Anthropic streams report `usage` only on `message_stop`. Token accounting (Phase 7 budgets) hooks `on_chat_model_end`, not per chunk.

### Risks to watch in the Phase 0 spike
- `ChatAnthropic` token streaming under Sonnet 4.6 1M may batch instead of per-token. If so, fall back to `streamMode: 'messages'` and synthesize deltas client-side.
- `ChatAnthropic` chunks may emit content as `[{type:'text_delta', text:...}]` arrays rather than plain strings. Port rev-ai's `_extract_text_from_chunk` filter (`server/main.py:1382-1392`) verbatim.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Vercel AI SDK | Excellent for chat UIs and basic tool calling, but no first-class **subagent** primitive, no virtual FS middleware, no skills loader. We'd reinvent the pieces that deepagents ships. |
| Anthropic SDK direct, hand-rolled | Maximum control, no framework lock-in — but a TS port of deepagents from scratch is months of work, and we'd own every bug forever. Same code path as the rev-ai team is rejecting in their Python port (they use deepagents directly, not raw Anthropic). |
| Stay on the current OpenAI loop | Doesn't deliver subagents, FS, todos, or multi-provider. Fails the brief. |

## Implementation

See plan phases:
- **Phase 0** (this commit): spike + ADR.
- **Phase 1**: `buildChatModel` role registry, `ChatAnthropic` adapter, Langfuse callback helper, dep bumps.
- **Phase 4**: full `AgentService.ts` rewrite on `createDeepAgent`.

Spike script: `packages/core/src/scripts/spike-deepagent.ts` (branch-only; not retained after Phase 4 lands).
