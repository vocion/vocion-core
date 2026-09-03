import type { RawStreamEvent } from './agents/traceEmitter';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { langfuse } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { agentSchema } from '@/models/Schema';
import { AnswerStreamer } from './agents/answerStream';
import { persistToolCall } from './agents/toolCallRecord';
import { extractChunk, parseJsonArgs, toolNodeId, toolOutputContent, TraceEmitter } from './agents/traceEmitter';

/* ------------------------------------------------------------------ */
/* Load agent config                                                   */
/* ------------------------------------------------------------------ */

export const getAgent = (orgId: string, slug: string) => {
  return db.query.agentSchema.findFirst({
    where: and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, slug)),
  });
};

export const listAgents = (_orgId: string) => {
  return db.query.agentSchema.findMany({
    where: eq(agentSchema.orgId, _orgId),
  });
};

export type AgentRow = Awaited<ReturnType<typeof listAgents>>[number];

export type AgentHierarchyView = {
  /** A primary agent — one with no parent. The front door you talk to. */
  primary: AgentRow;
  /** The specialized agents that report to this primary (parentAgentSlug === primary.slug). */
  specialists: AgentRow[];
};

/**
 * Group an org's agents into the primary → specialized hierarchy. A primary
 * agent has no `parentAgentSlug`; a specialist names its primary in that field.
 * The relationship is one level deep. A specialist whose parent slug resolves
 * to no agent in the org is surfaced defensively as its own primary, so no
 * agent is ever dropped from the registry.
 *
 * Pure (no DB) so it can be unit-tested; `listAgentHierarchy` wraps it.
 * @param agents - All agents in the org.
 */
export function groupAgentHierarchy(agents: AgentRow[]): AgentHierarchyView[] {
  const bySlug = new Map(agents.map(a => [a.slug, a]));
  const specialistsByParent = new Map<string, AgentRow[]>();
  const primaries: AgentRow[] = [];

  for (const a of agents) {
    const parent = a.parentAgentSlug;
    if (parent && bySlug.has(parent) && parent !== a.slug) {
      const list = specialistsByParent.get(parent) ?? [];
      list.push(a);
      specialistsByParent.set(parent, list);
    } else {
      // No parent, or a dangling/self parent — treat as a primary.
      primaries.push(a);
    }
  }

  const byName = (a: AgentRow, b: AgentRow) => a.name.localeCompare(b.name);

  return primaries
    .map(primary => ({
      primary,
      specialists: (specialistsByParent.get(primary.slug) ?? []).sort(byName),
    }))
    // Primaries that lead a team first, then alphabetical.
    .sort((a, b) => {
      const bySpecialists = (b.specialists.length > 0 ? 1 : 0) - (a.specialists.length > 0 ? 1 : 0);
      return bySpecialists !== 0 ? bySpecialists : byName(a.primary, b.primary);
    });
}

/**
 * Load an org's agents and group them into the primary → specialized hierarchy.
 * @param orgId - The active project/org id whose agents to group.
 */
export async function listAgentHierarchy(orgId: string): Promise<AgentHierarchyView[]> {
  return groupAgentHierarchy(await listAgents(orgId));
}

/* ------------------------------------------------------------------ */
/* runAgentDeep — opt-in deepagents runtime (Phase 4)                  */
/* ------------------------------------------------------------------ */

/**
 * Phase 4 runtime. Same return shape as `runAgent`, different engine.
 *
 * Opt-in via `VOCION_AGENT_RUNTIME=deepagents` or by calling this
 * function directly. The SSE route (Phase 4) will switch to this
 * once the flag is set; the legacy `runAgent` keeps backing the
 * existing nd-JSON route until then.
 *
 * Streaming model: deepagents JS exposes a `streamEvents(input,
 * { version: 'v3' })` API that returns a `DeepAgentRunStream` with
 * three AsyncIterable projections (`messages`, `toolCalls`, `subagents`)
 * plus a `Promise<finalState>` (`run.output`). We consume the three
 * projections in parallel, fan tokens out as `response_delta`, and let
 * tool factories emit `documents` / `skill_result` through the closure.
 *
 * Reasoning / chain-of-thought (investigated against deepagents@1.10.1):
 * each item yielded by `run.messages` is a `ChatModelStreamHandle`
 * (`@langchain/langgraph` → `@langchain/core/language_models/stream`
 * `ChatModelStream`), which exposes a `.reasoning` projection alongside
 * `.text` — an AsyncIterable of incremental reasoning deltas. The chain
 * is: Anthropic SSE `thinking_delta` → `@langchain/anthropic` emits an
 * `AIMessageChunk` with a `{ type: 'thinking' }` content block →
 * `@langchain/core` compat converts it to a `reasoning-delta` stream
 * event → `msg.reasoning` yields the delta string. So no raw-event
 * fallback or custom `handleLLMNewToken` callback is needed. (For the
 * record: the underlying standard LangChain `streamEvents(input,
 * { version: 'v2' })` is also still callable — deepagents' `streamEvents`
 * type is an intersection with `ReactAgent['streamEvents']`, so the v3
 * wrapper does not shadow the v2 surface — but the v3 `.reasoning`
 * projection is the cleaner mechanism.) Reasoning only flows when the
 * model is built with thinking enabled (`VOCION_THINKING_BUDGET`, see
 * `libs/llm/langchain.ts`); otherwise `msg.reasoning` simply completes
 * without yielding.
 * @param opts
 * @param opts.orgId
 * @param opts.agentSlug
 * @param opts.message
 * @param opts.userId
 * @param opts.allowedSourceSlugs
 * @param opts.missionSlug
 * @param opts.conversationHistory
 * @param opts.onEvent
 */

export async function runAgentDeep(opts: {
  orgId: string;
  agentSlug: string;
  message: string;
  userId?: string;
  /** Per-user connection ACL — restricts retrieval to these source slugs. */
  allowedSourceSlugs?: string[];
  /** Set for mission runs — lets mission-scoped tools (update_mission_notes) resolve their mission. */
  missionSlug?: string;
  /** Set for mission runs — the mission_run driving this turn, for audit stamps (`assessed_by`). */
  missionRunId?: number;
  /** Persisted conversation id — keys the AgentCore Memory session on the runtime provider (Phase 5, opt-in). */
  conversationId?: number;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  onEvent?: (event: import('./agents/types').AgentEvent) => void;
}): Promise<{
  response: string;
  traceId: string;
  toolCalls: Array<{ tool: string; input: Record<string, unknown>; output: string }>;
}> {
  // Local import keeps the legacy `runAgent` path from pulling
  // deepagents/LangChain modules at module-load time. (Cuts cold-start
  // for callers that never use the new runtime.)
  const { bindRequestEmit, buildInitialFiles, getCompiledAgent } = await import('./agents/harness');
  const { createLangfuseCallback } = await import('@/libs/Langfuse');
  const { chargeUsage, preflightCheck } = await import('./BudgetService');

  const rawEmit = opts.onEvent ?? (() => {});
  // Demo sandbox record buffer — every emitted event, in order (turnReplay).
  const recordedEvents: import('./agents/types').AgentEvent[] = [];
  // When a DELEGATE's search surfaces sources, tag those documents with the
  // specialist's name so the Sources drawer can show "via <specialist>".
  // `activeSpecialist` is set while a subagent's search tool is executing (the
  // window in which it emits its `documents` event via ctx.emit).
  let activeSpecialist: string | null = null;
  const emittedCards: string[] = [];
  const emit = (event: import('./agents/types').AgentEvent): void => {
    if (event.type === 'documents' && activeSpecialist) {
      for (const d of event.documents) {
        if (!d.foundBy) {
          d.foundBy = activeSpecialist;
        }
      }
    }
    if (event.type === 'recommended_action') {
      emittedCards.push(event.recommendation.label);
    }
    recordedEvents.push(event);
    rawEmit(event);
  };

  // Demo sandbox turn replay/record (VOCION_LLM_MODE) — see
  // services/agents/turnReplay.ts. Replay short-circuits the whole loop;
  // record captures the full event stream alongside the live run.
  const { maybeReplayTurn, recordTurn } = await import('./agents/turnReplay');
  const replayed = await maybeReplayTurn(opts, emit);
  if (replayed) {
    return replayed;
  }
  // Phase 7 — pre-flight budget check. Refuse the run if the agent
  // is over its hard cap; otherwise proceed.
  const budgetCheck = await preflightCheck({ orgId: opts.orgId, agentSlug: opts.agentSlug });
  if (!budgetCheck.ok) {
    const message = `Budget exceeded for agent "${opts.agentSlug}" (${budgetCheck.reason}: ${budgetCheck.current}/${budgetCheck.limit}). Raise the cap on /dashboard/agents/${opts.agentSlug} or wait for the next period.`;
    emit({ type: 'error', message });
    throw new Error(message);
  }

  // Harness provider dispatch — three execution layers, one contract:
  //   - `runtime`  (BYOA): the standalone agent-runtime artifact
  //     (localhost in dev, AgentCore Runtime when deployed). Also
  //     selectable fleet-wide via VOCION_AGENT_PROVIDER=runtime.
  //     VOCION_DISABLE_RUNTIME=1 forces the in-process loop instead —
  //     for dev machines where the artifact isn't running on :8080.
  //   - `agentcore` (managed harness): AWS runs the loop, tools call
  //     back inline. VOCION_DISABLE_AGENTCORE=1 forces the local loop —
  //     for dev machines with no AWS credentials / no provisioned
  //     harness, where an agentcore-pinned agent would otherwise be
  //     unchattable ("Tool error").
  //   - anything else: the in-process deepagents loop below.
  const [agentRow] = await db
    .select({ harnessConfig: agentSchema.harnessConfig })
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, opts.orgId), eq(agentSchema.slug, opts.agentSlug)));
  const provider = process.env.VOCION_AGENT_PROVIDER ?? agentRow?.harnessConfig?.provider;
  if (provider === 'runtime' && process.env.VOCION_DISABLE_RUNTIME !== '1') {
    const { runAgentOnRuntime } = await import('./agents/providers/runtime');
    return runAgentOnRuntime(opts);
  }
  if (provider === 'agentcore' && process.env.VOCION_DISABLE_AGENTCORE !== '1') {
    const { runAgentOnAgentCoreHarness } = await import('./agents/providers/agentcore');
    return runAgentOnAgentCoreHarness(opts);
  }

  const compiled = await getCompiledAgent(opts.orgId, opts.agentSlug);
  bindRequestEmit(compiled, emit, opts.userId, opts.allowedSourceSlugs, opts.missionSlug, opts.missionRunId, opts.conversationId);
  const boundCtx = (compiled as unknown as { __ctx: import('./agents/types').RuntimeContext }).__ctx;

  const toolCallLog: Array<{ tool: string; input: Record<string, unknown>; output: string }> = [];
  // Full (untruncated) tool outputs — the sanitizer needs the whole thing to
  // strip a verbatim echo (toolCallLog truncates for the event/audit surface).
  const rawToolOutputs: string[] = [];

  // Langfuse trace via the v0.2 BaseCallbackHandler adapter.
  const { handler: langfuseHandler, trace } = createLangfuseCallback({
    feature: FEATURES.AGENT_CHAT,
    slug: compiled.agentRow.slug,
    orgId: opts.orgId,
    userId: opts.userId ?? 'system',
    input: { message: opts.message },
    metadata: { agentId: compiled.agentRow.id, runtime: 'deepagents' },
    onTurnEnd: async (turn) => {
      await chargeUsage({
        orgId: opts.orgId,
        agentSlug: opts.agentSlug,
        model: turn.model,
        usage: {
          inputTokens: turn.inputTokens,
          outputTokens: turn.outputTokens,
          cacheReadTokens: turn.cacheReadTokens,
        },
      });
    },
  });

  // Link tool_call rows to this turn's trace — cost and latency are read there.
  boundCtx.traceId = trace.id;

  emit({ type: 'thinking' });

  const initialFiles = await buildInitialFiles(opts.orgId, opts.agentSlug);

  const history = (opts.conversationHistory ?? [])
    .filter(t => t.content.trim().length > 0)
    .map(t => ({ role: t.role, content: t.content }));

  // The agent's system prompt is supplied to the graph via createDeepAgent's
  // `systemPrompt` (see runtime.ts). It must NOT also appear here — deepagents
  // prepends its own system message, so a second one is rejected by the model.
  const input = {
    messages: [
      ...history,
      { role: 'user', content: opts.message },
    ],
    files: initialFiles,
  };

  let finalText = '';

  // Typed hierarchical trace: consume the RAW LangChain `streamEvents(v2)`
  // stream (not the flat deepagents v3 projection) so a specialist's own
  // reasoning, tools, and citations are attributable and nested. The
  // `TraceEmitter` maps each raw event to typed `trace_node`s; here we also
  // derive the answer text (LEAD assistant text only — a subagent's text
  // stays in its nested reason node and never leaks into the reply) and the
  // tool outputs the post-run sanitizer needs.
  const tracer = new TraceEmitter({ leadName: compiled.agentRow.name ?? compiled.agentRow.slug ?? 'Assistant' });
  const PLUMBING = new Set(['write_todos', 'ls', 'glob', 'grep', 'read_file', 'edit_file', 'write_file']);

  const nsFor = (ev: RawStreamEvent): string => {
    const cp = ev.metadata?.checkpoint_ns;
    if (typeof cp === 'string') {
      return cp;
    }
    if (Array.isArray(cp)) {
      return cp.join('|');
    }
    return String(ev.metadata?.langgraph_node ?? '');
  };

  // True streaming: the LEAD's answer streams live token-by-token via the
  // AnswerStreamer, which strips a leading <scratch>…</scratch> block (routed
  // to chain-of-thought) so raw data never dumps into the answer. No post-run
  // buffering.
  const answerStreamer = new AnswerStreamer();
  let answering = false;

  try {
    const stream = await compiled.graph.streamEvents(input as never, {
      version: 'v2',
      callbacks: [langfuseHandler],
    } as never);

    for await (const evUnknown of stream as AsyncIterable<RawStreamEvent>) {
      const ev = evUnknown;

      // 1) Typed trace nodes for the UI (reason/tool/skill/search/delegate + citations).
      const nodes = tracer.handle(ev);
      for (const node of nodes) {
        emit(node);
      }
      // Track a delegate's active search so its emitted documents get attributed.
      if (ev.event === 'on_tool_start') {
        const specialistSearch = nodes.find(n => n.kind === 'search' && n.actor.kind === 'specialist');
        if (specialistSearch) {
          activeSpecialist = specialistSearch.actor.name;
        }
        // Record the delegation so the tool-call record can attribute the
        // specialist's nested calls to it (taskId → subagent name). The
        // task starts a full model roundtrip before the specialist's first
        // tool call, so the map is populated well ahead of any lookup.
        if (ev.name === 'task') {
          const args = parseJsonArgs(ev.data?.input);
          const subagentType = typeof args.subagent_type === 'string' ? args.subagent_type : 'specialist';
          boundCtx.delegations?.set(toolNodeId(nsFor(ev)), subagentType);
        }
      } else if (ev.event === 'on_tool_end' && (ev.name === 'search_knowledge' || ev.name === 'web_search')) {
        activeSpecialist = null;
      }
      // A mounted skill being read is capability usage — record it. The
      // file tools are deepagents built-ins the registry never sees, so
      // this is the one record written from the stream instead.
      if (ev.event === 'on_tool_end' && ev.name === 'read_file') {
        const args = parseJsonArgs(ev.data?.input);
        const path = typeof args.file_path === 'string' ? args.file_path : (typeof args.path === 'string' ? args.path : '');
        const m = path.match(/^\/(?:skills|playbooks)\/([^/]+)\//);
        if (m) {
          void persistToolCall({
            ctx: boundCtx,
            tool: 'skill_read',
            input: { slug: m[1], path },
            output: '',
            durationMs: 0,
            ns: nsFor(ev),
          });
        }
      }

      // 2) Derive the answer + backward-compatible events from the same stream.
      const isLead = !nsFor(ev).includes('|');
      switch (ev.event) {
        case 'on_chat_model_stream': {
          const { text, thinking } = extractChunk(ev.data?.chunk);
          if (isLead && thinking) {
            emit({ type: 'thinking_delta', delta: thinking });
          }
          if (isLead && text) {
            const { answer, thinking: scratch } = answerStreamer.push(text);
            if (scratch) {
              emit({ type: 'thinking_delta', delta: scratch });
            }
            if (answer) {
              if (!answering) {
                answering = true;
                emit({ type: 'answering' });
                // Reasoning is over once the answer begins — close open reason
                // nodes so they stop spinning "Thinking" during the tail.
                for (const node of tracer.closeReasoning()) {
                  emit(node);
                }
              }
              finalText += answer;
              emit({ type: 'response_delta', delta: answer });
            }
          }
          break;
        }
        case 'on_tool_start': {
          const tool = ev.name ?? 'tool';
          // `task` (delegation) is surfaced as a delegate trace node, not a
          // tool breadcrumb; plumbing tools are noise.
          if (tool !== 'task' && !PLUMBING.has(tool)) {
            emit({ type: 'tool_start', tool, input: parseJsonArgs(ev.data?.input) });
          }
          break;
        }
        case 'on_tool_end': {
          const tool = ev.name ?? 'tool';
          const outputFull = toolOutputContent(ev.data?.output);
          if (outputFull) {
            rawToolOutputs.push(outputFull);
          }
          if (tool !== 'task' && !PLUMBING.has(tool)) {
            const input = parseJsonArgs(ev.data?.input);
            const outputStr = outputFull.slice(0, 2000);
            emit({ type: 'tool_end', tool, input, output: outputStr });
            toolCallLog.push({ tool, input, output: outputStr });
          }
          break;
        }
        default:
          break;
      }
    }

    // Note: per-actor citations ride on the `trace_node` events (so the trace
    // can show "found by <specialist>"); the Sources drawer keeps using the
    // richer `documents` event the search tool emits via ctx.emit.
  } catch (err) {
    const message = (err as Error).message ?? 'agent run failed';
    emit({ type: 'error', message });
    trace.update({ output: { error: message } });
    await langfuse.flushAsync();
    throw err;
  }

  // Release any held-back tail (partial-tag boundary) from the streamer.
  const tail = answerStreamer.flush();
  if (tail.thinking) {
    emit({ type: 'thinking_delta', delta: tail.thinking });
  }
  if (tail.answer) {
    finalText += tail.answer;
    emit({ type: 'response_delta', delta: tail.answer });
  }
  finalText = finalText.trim();

  // Card backstop (structural, workspace-opt-in): prompt compliance for
  // recommend_action proved unreliable — a long tool output (the daily brief)
  // anchors the model into prose mode and cards drop from 3 to 0. When the
  // agent's harness sets recommendActionBackstop and this turn emitted ZERO
  // cards, run one focused pass over the finished answer whose only job is
  // emitting the cards the agent's own rules require. Tool execution emits
  // the recommended_action events through the same request emit.
  // Fires on UNDER-carding too (< 3), not just zero — a single card must not
  // suppress the pass when the answer names several owed touches. The pass
  // sees what's already carded and only tops up the missing ones.
  const backstopOn = (compiled.agentRow.harnessConfig as { recommendActionBackstop?: boolean } | null)?.recommendActionBackstop === true;
  if (backstopOn && emittedCards.length < 3 && finalText.length > 300) {
    try {
      const { recommendActionTool } = await import('./agents/tools/recommendAction');
      const internalCtx = (compiled as unknown as { __ctx: import('./agents/types').RuntimeContext }).__ctx;
      const recTool = recommendActionTool(internalCtx);
      const { buildChatModelForOrg } = await import('@/libs/llm');
      const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
      const base = await buildChatModelForOrg('main', opts.orgId, { temperature: 0, streaming: false, maxTokens: 4000 });
      if (!base.bindTools) {
        throw new Error('model does not support tools');
      }
      const model = base.bindTools([recTool]);
      const already = emittedCards.length > 0
        ? `\nAlready carded (do NOT duplicate these): ${emittedCards.map(l => `"${l}"`).join(', ')}.`
        : '';
      const sys = `${compiled.agentRow.systemPrompt ?? ''}\n\nBACKSTOP PASS: the answer below was ALREADY delivered to the user — do not rewrite it. Your ONLY job now: emit the recommend_action tool calls your rules above require for the owed/actionable touches NAMED in that answer (top 3–5 by leverage).${already} Real, ready-to-send bodies. If every named touch is already carded or none are actionable, call nothing. Output tool calls only — no prose.`;
      const res = await model.invoke(
        [new SystemMessage(sys), new HumanMessage(finalText)],
        { signal: AbortSignal.timeout(45_000) },
      );
      for (const call of res.tool_calls ?? []) {
        if (call.name === 'recommend_action') {
          await recTool.invoke(call.args as never);
        }
      }
    } catch {
      /* backstop is best-effort — never fails the turn */
    }
  }

  trace.update({ output: { response: finalText.slice(0, 500), tool_calls: toolCallLog.length } });
  await langfuse.flushAsync();

  emit({ type: 'done', response: finalText, traceId: trace.id });

  recordTurn(opts, recordedEvents, {
    response: finalText,
    traceId: trace.id,
    toolCalls: toolCallLog,
  });

  return {
    response: finalText,
    traceId: trace.id,
    toolCalls: toolCallLog,
  };
}
