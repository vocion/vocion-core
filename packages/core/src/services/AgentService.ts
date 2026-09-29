import type { BaseMessage } from '@langchain/core/messages';
import type { AnswerComposer } from './agents/answerBackstop';
import type { TurnFailure } from './agents/deliverableBackstop';
import type { HarnessTarget } from './agents/harnessTarget';
import type { RawStreamEvent } from './agents/traceEmitter';
import type { AgentEvent } from './agents/types';
import type { Deliverable } from '@/libs/chat/deliverable';
import type { LangfuseTurnUsage } from '@/libs/Langfuse';
import type { HistoryTurn } from '@/services/chat/historyTools';
import process from 'node:process';
import { and, eq } from 'drizzle-orm';
import { normalizeAnswerHtml } from '@/libs/chat/answerText';
import { appendRecordLinks } from '@/libs/chat/recordLinks';
import { stripScratch } from '@/libs/chat/scratch';
import { db } from '@/libs/DB';
import { flushTraces } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { modelForStrength } from '@/libs/llm/modelPrefs';
import { tokenCostMicroCents } from '@/libs/pricing';
import { clockLine, DEFAULT_TIME_ZONE } from '@/libs/time/zone';
import { versionLinksDelta } from '@/libs/versions/versionRef';
import { agentSchema } from '@/models/Schema';
import { flatHistory, historyMessages, withLiveCardState } from '@/services/chat/historyTools';
import { preambleOnly } from '@/services/chat/turnStatus';
import { composeAnswerWithModel, evidenceBlock, runAnswerBackstop } from './agents/answerBackstop';
import { AnswerStreamer } from './agents/answerStream';
import { composeArtifactWithModel, runDeliverableBackstop } from './agents/deliverableBackstop';
import { normalizeHarnessTarget } from './agents/harnessTarget';
import { announcedAction, asksForAction, DECIDE_TOOLS, decidedInTurn, decideOwed, decisionNamed, describeOpenDecisions, mergeDecisions, openDecisionsOn, pendingCards, personWords } from './agents/owedDecision';
import { answerNamesFiled, asksToChange, asksToFile, attemptedChange, changedInTurn, changeOwedRecord, fileOwedWrite, owedChangeTarget, owedWriteTool } from './agents/owedWriteBackstop';
import { labelStep } from './agents/stepLabeler';
import { describeTurnFailure, stepLimitStreamConfig } from './agents/stepLimit';
import { persistToolCall } from './agents/toolCallRecord';
import { extractChunk, parseJsonArgs, toolErrorMessage, toolNodeId, toolOutputContent, toolResultStatus, TraceEmitter } from './agents/traceEmitter';
import { TurnRefusedError } from './agents/turnRefusal';
import { cardClaim, unbackedWriteNotice, writeClaim, writeLanded, wroteInTurn } from './agents/writeClaim';

/**
 * A tool's name written as the turn's last word — narrated, not called — or a
 * whole call imitated as text at the end of the message: production turn 608
 * (2026-09-24) ended with "CARD" and a fenced block beginning
 * `recommend_action id: …`. Either way the person saw words where a card
 * should have been.
 */
/**
 * A tool call the tool itself refused for its arguments — retryable, not fatal.
 * @param err
 */
function isToolInputError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err ?? '');
  return /did not match expected schema|Received tool input|invalid arguments/i.test(m);
}

const TOOL_NAMES = 'recommend_action|propose_action|file_ask|update_object|withdraw_proposal|decide_proposal|decide_ask';
/**
 * A call written out instead of made. Three shapes seen in production:
 *   1. a fenced block that STARTS with the tool's name, at the end of the answer;
 *   2. the bare tool name as the last word;
 *   3. a heading naming the tool — "**update_object — request 30**" — followed
 *      by a ```json block of its arguments (mission run 4905, 2026-09-25:
 *      three of them, nothing written; finding 19).
 */
const NARRATED_TOOL = new RegExp(`(?:^|\\n)\\s*(?:(?:CARD|Card)\\s*)?\`\`\`[a-z]*\\s*(${TOOL_NAMES})\\b[\\s\\S]*?\`\`\`\\s*$|(?:^|[\\s*_\`])(${TOOL_NAMES})[*_\`]*\\s*$|(?:^|\\n)\\s*(?:\\*\\*|#{1,4}\\s*)?\`?(${TOOL_NAMES})\\b[^\\n]*\\n\\s*\`\`\`[a-z]*\\n[\\s\\S]*?\`\`\``);
/**
 * A card written out as prose: a heading line beginning "CARD —" (or "Card:")
 * and everything under it to the end of the answer. Stripped only when a real
 * card is on screen, so a turn is never left with neither.
 */
const NARRATED_CARD = /\n\s*(?:\*\*|#{1,4}\s*)?CARD\s*(?:[—–:-]|\*\*)[\s\S]*$/i;
/** How long one turn may run before it is stopped: `VOCION_TURN_DEADLINE_MS`, default eight minutes. Read per turn so a test can shorten it. */
function turnDeadlineMs(): number {
  const raw = Number(process.env.VOCION_TURN_DEADLINE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 8 * 60 * 1000;
}
const NARRATED_TOOL_TAIL = new RegExp(`\\n\\s*(?:(?:CARD|Card)\\s*)?\`\`\`[a-z]*\\s*(?:${TOOL_NAMES})\\b[\\s\\S]*?\`\`\`\\s*$|[\\s*_\`]*(?:${TOOL_NAMES})[*_\`]*\\s*$|\\n\\s*(?:\\*\\*|#{1,4}\\s*)?\`?(?:${TOOL_NAMES})\\b[^\\n]*\\n\\s*\`\`\`[a-z]*\\n[\\s\\S]*$`);

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

/**
 * Which machinery an agent gets when its author named none.
 *
 * Choosing Bedrock as the model vendor now also chooses where the loop runs:
 * `modelProvider: bedrock` defaults to `agentcore-container` — our own loop, in
 * our container, hosted on AWS AgentCore Runtime. The two settings used to be
 * unrelated axes, so an installation could be entirely on Bedrock and still run
 * every agent in this process, and every agent had to repeat the target by hand
 * to reach AWS at all.
 *
 * Nothing is forced: an explicit `runsOn` still wins (it is read before this
 * function is consulted), `VOCION_AGENT_PROVIDER` still overrides fleet-wide,
 * and `VOCION_DISABLE_RUNTIME=1` still sends everything back to the in-process
 * loop for a dev machine with no container on :8080.
 *
 * Anthropic and OpenAI agents are unaffected and keep running in process,
 * because the container's own model path reaches those vendors only when the
 * container itself is configured for them.
 * @param modelProvider - The agent's `harness.modelProvider`, if it set one.
 */
function defaultHarnessTargetFor(
  modelProvider: 'anthropic' | 'openai' | 'bedrock' | undefined,
): HarnessTarget | undefined {
  if (modelProvider === 'bedrock') {
    return 'agentcore-container';
  }
  return undefined;
}

/**
 * Where this installation runs an agent that named no target at all:
 * `VOCION_DEFAULT_RUNS_ON`, read last.
 *
 * `VOCION_AGENT_PROVIDER` already moves a whole fleet, but it is an OVERRIDE —
 * read first, above every agent's own `runsOn` — so it also moves the agents
 * that must not move: an `external-worker` engineer whose runs a process
 * outside Vocion claims, an agent pinned to AWS's managed harness. A deployment
 * moving its fleet onto the container wants the opposite precedence: every
 * agent that said nothing goes, every agent that said something stays. Without
 * this, that meant an `extends: core` override per plugin agent, and an
 * override replaces the whole `harness:` block, so each one had to restate the
 * plugin's grants and backstops too.
 *
 * Only the two loops Vocion owns are accepted. A fleet default of
 * `external-worker` would queue every chat turn for a process that may not
 * exist, and `aws-managed-harness` strips the loop to one tool; both stay
 * per-agent decisions.
 */
function fleetDefaultHarnessTarget(): HarnessTarget | undefined {
  const target = normalizeHarnessTarget(process.env.VOCION_DEFAULT_RUNS_ON);
  return target === 'in-process' || target === 'agentcore-container' ? target : undefined;
}

/* ------------------------------------------------------------------ */
/* End-of-turn guarantees — structural, not prompted                   */
/* ------------------------------------------------------------------ */

/** A delegation that started and did not come back with an answer. */
export type FailedDelegation = { name: string; message: string };

/** Words a model uses when it HAS owned up to a failure. */

const ADMITS_FAILURE = /\b(?:fail(?:ed|ure)?|could ?n[o']t|was ?n[o']t able|unable|errored|error|did ?n[o']t (?:complete|finish|work)|broke)\b/i;

/**
 * The sentence a person gets when a hand-off failed and the answer did not say
 * so.
 *
 * This is the structural half of "delegation failures reach the person": the
 * model is asked to mention it, and when it does not, code says it anyway.
 * Prompting alone put a confident answer on top of a specialist that never
 * ran — the failure existed only as a badge in the trace.
 *
 * Returns null when there is nothing to say, or when the answer already names
 * the specialist AND admits something went wrong, so the person never reads
 * the same bad news twice.
 * @param failed - Delegations that did not complete.
 * @param answer - The answer text as it stands.
 */
export function delegationFailureNotice(failed: ReadonlyArray<FailedDelegation>, answer: string): string | null {
  if (failed.length === 0) {
    return null;
  }
  const text = answer ?? '';
  const named = failed.filter(f => !(text.toLowerCase().includes(f.name.toLowerCase()) && ADMITS_FAILURE.test(text)));
  if (named.length === 0) {
    return null;
  }
  const names = named.map(f => f.name);
  const who = names.length === 1
    ? names[0]!
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
  const why = named[0]!.message.trim();
  return `The hand-off to ${who} did not complete${why ? ` (${why})` : ''}, so nothing from that step is in this answer.`;
}

/** Everything the end-of-turn pass needs, from whichever harness ran the loop. */
export type TurnGuaranteeInput = {
  orgId: string;
  agentSlug: string;
  userId?: string;
  conversationId?: number;
  deliverable?: Deliverable;
  /** The person's message for this turn. */
  request: string;
  /** The answer the turn produced. */
  response: string;
  toolCalls: ReadonlyArray<{ tool: string; input?: Record<string, unknown>; output?: string }>;
  /** Cards the turn put in front of the person; undefined when the harness cannot say. */
  cardsShown?: number;
  /** The turn's last event was a tool result, not words — it owes an answer whatever its length. */
  endedOnTool?: boolean;
  failures: ReadonlyArray<TurnFailure>;
  failedDelegations: ReadonlyArray<FailedDelegation>;
  systemPrompt?: string;
  emit: (event: AgentEvent) => void;
  /** Injected in tests; the harness passes the real gated pass. */
  compose?: Parameters<typeof runDeliverableBackstop>[0]['compose'];
  /** The answer pass for a stalled turn; injected in tests. */
  answer?: AnswerComposer;
  /** The conversation before this turn, so the answer pass reads what the turn could. */
  history?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  /** The graph's own messages for the turn, for the answer pass to continue from. */
  messages?: readonly unknown[];
  /** The agent's card tools, bound in the answer pass so a card is a real call. */
  cardTools?: readonly import('@langchain/core/tools').StructuredToolInterface[];
  /** Where the answer pass's calls are run and recorded. */
  onToolCall?: (call: import('./agents/answerBackstop').AnswerPassCall) => Promise<void>;
};

/**
 * Everything a finished turn owes the person, applied in code rather than
 * asked for in a prompt:
 *
 *   1. a failed delegation is stated in the answer,
 *   2. a write the answer claims as done is a write that ran, and
 *   3. a turn sent with `deliverable: 'artifact'` ends with an artifact.
 *
 * Runs for EVERY harness target — it reads the finished text and the tool
 * calls, which all of them return — so the guarantee does not depend on where
 * the loop executed. Each appended sentence also goes out as a
 * `response_delta`, so the live transcript and the persisted message say the
 * same thing.
 *
 * Never throws: a guarantee that can fail the turn it is guaranteeing is worse
 * than the gap it closes.
 * @param input - See {@link TurnGuaranteeInput}.
 */
export async function applyTurnGuarantees(input: TurnGuaranteeInput): Promise<string> {
  let text = input.response;
  const append = (sentence: string): void => {
    const delta = `${text.trim().length > 0 ? '\n\n' : ''}${sentence}`;
    text = `${text}${delta}`;
    input.emit({ type: 'response_delta', delta });
  };

  // A TURN THAT WORKED AND DID NOT ANSWER IS ANSWERED HERE — before anything
  // else is appended, so what follows reads under an answer and not under a
  // preamble (services/agents/answerBackstop.ts).
  try {
    // The answer streams as it is written: the first delta opens the
    // paragraph, the rest follow it, and `text` holds exactly what was sent.
    let streamed = false;
    const onDelta = (delta: string): void => {
      if (!streamed) {
        streamed = true;
        // Leading whitespace would stack under the break that opens the answer.
        const lead = `${text.trim().length > 0 ? '\n\n' : ''}${delta.trimStart()}`;
        text = `${text}${lead}`;
        input.emit({ type: 'response_delta', delta: lead });
        return;
      }
      text = `${text}${delta}`;
      input.emit({ type: 'response_delta', delta });
    };
    const answered = await runAnswerBackstop({
      orgId: input.orgId,
      request: input.request,
      finalText: text,
      toolCalls: input.toolCalls,
      endedOnTool: input.endedOnTool === true,
      systemPrompt: input.systemPrompt,
      history: input.history,
      messages: input.messages,
      tools: input.cardTools,
      onToolCall: input.onToolCall,
      // Say it: the answer is being written from what the steps found.
      compose: (args) => {
        input.emit({ type: 'status', label: `Writing the answer from ${input.toolCalls.length} step${input.toolCalls.length === 1 ? '' : 's'}` });
        return (input.answer ?? composeAnswerWithModel)(args);
      },
      onDelta,
    });
    // A composer that does not stream (tests, a provider without it) still
    // answers: the whole answer goes out as one delta, as before.
    if (answered && !streamed) {
      append(answered);
    }
  } catch (err) {
    console.warn(`answer backstop failed for org ${input.orgId} agent ${input.agentSlug}: ${(err as Error).message}`);
  }

  const notice = delegationFailureNotice(input.failedDelegations, text);
  if (notice) {
    append(notice);
  }

  // A WRITE CLAIMED WITH NO WRITE BEHIND IT is corrected here, after the
  // answer pass, so a claim that pass made is checked too (finding 23,
  // services/agents/writeClaim.ts).
  const unbacked = unbackedWriteNotice(text, input.toolCalls, input.cardsShown);
  if (unbacked) {
    console.warn(`turn claimed a write with none behind it for org ${input.orgId} agent ${input.agentSlug}: "${writeClaim(text) ?? cardClaim(text)}"`);
    append(unbacked);
  }

  if (input.deliverable === 'artifact') {
    try {
      const backstop = await runDeliverableBackstop({
        orgId: input.orgId,
        agentSlug: input.agentSlug,
        userId: input.userId,
        conversationId: input.conversationId,
        deliverable: input.deliverable,
        request: input.request,
        finalText: text,
        toolCalls: input.toolCalls,
        failures: input.failures,
        emit: input.emit,
        systemPrompt: input.systemPrompt,
        compose: input.compose ?? composeArtifactWithModel,
      });
      if (backstop) {
        append(backstop.notice);
      }
    } catch (err) {
      console.warn(`deliverable backstop failed for org ${input.orgId} agent ${input.agentSlug}: ${(err as Error).message}`);
    }
  }

  return text;
}

/**
 * Run a turn on a harness that is NOT this process, and still apply the
 * end-of-turn guarantees.
 *
 * The other harness targets stream their own `done`, which is the last thing
 * the client waits on — so a guarantee applied after it would arrive at a
 * transcript that had already closed. This holds that one frame back, runs the
 * guarantees (which may append sentences and open the artifact pane), and then
 * emits `done` carrying the amended answer. Every other event passes through
 * untouched and in order.
 * @param opts - The turn, as `runAgentDeep` received it.
 * @param emit - The request emit.
 * @param run - Starts the provider with the emit it should use.
 */
async function runOutOfProcess(
  opts: Parameters<typeof runAgentDeep>[0],
  emit: (event: AgentEvent) => void,
  run: (onEvent: (event: AgentEvent) => void) => Promise<{ response: string; traceId: string; toolCalls: Array<{ tool: string; input: Record<string, unknown>; output: string }>; usage?: RunUsage }>,
): Promise<{ response: string; traceId: string; toolCalls: Array<{ tool: string; input: Record<string, unknown>; output: string }>; usage?: RunUsage }> {
  const failures: TurnFailure[] = [];
  let held: Extract<AgentEvent, { type: 'done' }> | null = null;
  // The other loops stream their answer as-is; a <scratch> block the model
  // opened there is set aside at this seam, the same way the in-process loop
  // does it, so no harness can put the model's thinking into the transcript.
  const streamer = new AnswerStreamer();
  // A call written as text never shows as text here either; the other loops
  // hold no tools in this process to run it with, so it is said, not dropped.
  const heldCalls: import('./agents/textToolCalls').TextCall[] = [];
  const gated = (event: AgentEvent): void => {
    if (event.type === 'tool_error') {
      failures.push({ tool: event.tool, message: event.message });
    }
    if (event.type === 'done') {
      held = event;
      return;
    }
    if (event.type === 'response_delta') {
      const { answer, thinking, calls } = streamer.push(event.delta);
      heldCalls.push(...calls);
      if (thinking) {
        emit({ type: 'thinking_delta', delta: thinking });
      }
      if (answer) {
        emit({ type: 'response_delta', delta: answer });
      }
      return;
    }
    emit(event);
  };

  const result = await run(gated);
  const tail = streamer.flush();
  heldCalls.push(...tail.calls);
  if (tail.thinking) {
    emit({ type: 'thinking_delta', delta: tail.thinking });
  }
  if (tail.answer) {
    emit({ type: 'response_delta', delta: tail.answer });
  }
  if (heldCalls.length > 0) {
    // A block that could not run is left out of the reply, not noted in it:
    // the person cannot act on it (Chris, 2026-09-29). The log keeps it.
    const { extractTextCalls, parseTextCall } = await import('./agents/textToolCalls');
    console.warn('agent turn: tool-call blocks written as text on a loop outside this process did not run', { orgId: opts.orgId, agentSlug: opts.agentSlug, labels: heldCalls.map(c => parseTextCall(c).label) });
    result.response = extractTextCalls(result.response).text;
  }
  const response = await applyTurnGuarantees({
    orgId: opts.orgId,
    agentSlug: opts.agentSlug,
    userId: opts.userId,
    conversationId: opts.conversationId,
    deliverable: opts.deliverable,
    request: opts.message,
    response: stripScratch(result.response),
    toolCalls: result.toolCalls,
    history: (opts.conversationHistory ?? []).map(t => ({ role: t.role, content: t.content })),
    failures,
    // Delegation nesting is not visible across the transport (the other
    // harnesses run their own loop and report tool failures flat), so a failed
    // hand-off surfaces there as an ordinary tool failure.
    failedDelegations: [],
    emit,
  });
  const done: Extract<AgentEvent, { type: 'done' }> = held ?? { type: 'done', response, traceId: result.traceId };
  emit({ ...done, response });
  return { ...result, response };
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
  /**
   * What this turn's OpenTelemetry spans are grouped under, when the turn runs
   * out of process. A caller that knows what the turn belongs to — the eval
   * runner knows the case — should name it, so the spans can be found and
   * graded as that one thing. See `services/evals/sessionIds.ts`.
   */
  sessionId?: string;
  conversationHistory?: HistoryTurn[];
  /** Where the person is in the app for this turn — exposed to the `page_context` tool. */
  pageContext?: import('./chat/pageContext').PageContext;
  /** The person's IANA time zone for this turn (from the browser); the workspace's when absent. */
  timeZone?: string;
  /**
   * What this turn OWES (`libs/chat/deliverable.ts`). `artifact` means the
   * turn must end with an artifact beside the conversation; if the loop does
   * not make one, `applyTurnGuarantees` does. `answer` (and absent) means the
   * reply is the whole deliverable and nothing is wrapped.
   *
   * It is a typed field on the request rather than a line in the system
   * prompt because "did this turn produce an artifact" is a requirement, not a
   * judgement — and three rounds of prompt wording is exactly the failure mode
   * CLAUDE.md's *Structural over prompting* bullet is about.
   */
  deliverable?: Deliverable;
  /**
   * Files the person attached to this turn (`services/chat/attachments.ts`).
   * An image reaches the model as an image block; a document as its text
   * under the message. Absent or empty means the input is the message string,
   * exactly as before.
   */
  attachments?: import('./chat/attachments').LoadedAttachment[];
  onEvent?: (event: import('./agents/types').AgentEvent) => void;
  /**
   * Run this ONE turn on a named model instead of the agent's own. The
   * model-upgrade test (`services/evals/modelUpgradeTest.ts`) is the caller.
   * Forces the in-process loop: the other harness targets build their model
   * from the agent row, and a payload field they would ignore is worse than
   * an honest single path. Never cached — see `compileAgentForRequest`.
   */
  modelOverride?: import('./agents/harness').ModelOverride;
  /**
   * The conversation's model preferences (`libs/llm/modelPrefs.ts`): how
   * strong a model, how much it thinks. Applied only on the in-process loop
   * — never moving a turn off the harness the agent runs on — and only when
   * they ask for something beyond the agent's own defaults.
   */
  modelPrefs?: import('@/libs/llm/modelPrefs').ModelPrefs;
}): Promise<{
  response: string;
  traceId: string;
  /**
   * Every tool call, with its whole output. The agent already holds that
   * string in its own history, so keeping it here costs a reference, not a
   * copy — and an eval check reading a lookup's JSON or a page's text sees
   * exactly what the agent saw.
   */
  toolCalls: Array<{ tool: string; input: Record<string, unknown>; output: string }>;
  /**
   * Token usage across every model turn of this run, priced by
   * `tokenCostMicroCents`. `model` is the id the provider reported on the last
   * turn. Present on the in-process loop; the other harness targets report
   * usage through their own channels and leave this undefined.
   */
  usage?: RunUsage;
}> {
  // Local import keeps the legacy `runAgent` path from pulling
  // deepagents/LangChain modules at module-load time. (Cuts cold-start
  // for callers that never use the new runtime.)
  const { buildInitialFiles, compileAgentForRequest } = await import('./agents/harness');
  const { createLangfuseCallback } = await import('@/libs/Langfuse');
  const { chargeUsage, preflightCheck } = await import('./BudgetService');
  const { BudgetGateCallback, budgetRefusalMessage, TurnBudgetGuard } = await import('./agents/budgetStop');

  const rawEmit = opts.onEvent ?? (() => {});
  // Demo sandbox record buffer — every emitted event, in order (turnReplay).
  const recordedEvents: import('./agents/types').AgentEvent[] = [];
  // When a DELEGATE's search surfaces sources, tag those documents with the
  // specialist's name so the Sources drawer can show "via <specialist>".
  // `activeSpecialist` is set while a subagent's search tool is executing (the
  // window in which it emits its `documents` event via ctx.emit).
  let activeSpecialist: string | null = null;
  const emittedCards: string[] = [];
  // Records the turn made (a data room, a proposal) — linked at the end of the
  // answer if the model forgot to (`appendRecordLinks`).
  const createdRecords: import('@/services/chat/pageContext').RecordRef[] = [];
  // Versions the turn wrote (a record changed) — linked at the end (`versionLinksDelta`).
  const writtenVersions: import('@/libs/versions/versionRef').WrittenVersion[] = [];
  // The record the person's page shows, when it is one (`/p/feature/201` is request 201).
  const pageRecordRef = opts.pageContext?.record?.type === 'object' && /^\d+$/.test(opts.pageContext.record.id) ? { type: 'object' as const, id: opts.pageContext.record.id, label: opts.pageContext.record.label } : null;
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
    if (event.type === 'record_created') {
      createdRecords.push(event.record);
    }
    if (event.type === 'version_written' && !event.related) {
      writtenVersions.push({ ref: event.ref, to: event.to });
    }
    recordedEvents.push(event);
    rawEmit(event);
    // A WRITE BENEATH THE PAGE'S RECORD SHOWS ON THE PAGE. Conversation 378
    // (2026-09-29): on request #201's feature page a plan, a task's contract
    // or a decided card is a different record from #201, and the page
    // watches #201 only, so nothing the turn did reached the screen until a
    // reload (Chris: "changes should stream to the feature detail page").
    // Every write that lands in a turn on a record's page is announced as a
    // version beneath that record; the page refetches in place and marks
    // the sections that changed (`VersionWatch`).
    if (event.type === 'tool_end' && pageRecordRef && writeLanded({ tool: event.tool, output: event.output })) {
      const beneath = { type: 'version_written' as const, ref: pageRecordRef, artifactId: 0, from: null, to: 0, related: event.tool };
      recordedEvents.push(beneath);
      rawEmit(beneath);
    }
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
    // Names the row that refused, not the agent that asked: since #279 the
    // check also covers the workspace-wide cap, and "raise the cap on this
    // agent" would send someone to a page that cannot fix it. An agent with no
    // cap of its own is told which default held it (#272).
    const message = budgetRefusalMessage(budgetCheck);
    emit({ type: 'error', message });
    // Refused, not broken: no run started, so the turn is stored as `refused`
    // and the person reads what to change rather than "the answer stopped
    // partway through" (#114).
    throw new TurnRefusedError(message);
  }

  // Harness dispatch — three targets, one event contract:
  //   - `agentcore-container`: OUR deepagents loop, in the
  //     packages/agent-runtime container (localhost in dev, AWS
  //     AgentCore Runtime when deployed). VOCION_DISABLE_RUNTIME=1
  //     forces the in-process loop instead — for dev machines where the
  //     container isn't running on :8080.
  //   - `aws-managed-harness`: AWS owns the loop; our tools are called
  //     back inline. VOCION_DISABLE_AGENTCORE=1 forces the in-process
  //     loop — for dev machines with no AWS credentials / no provisioned
  //     harness, where such an agent would otherwise be unchattable
  //     ("Tool error").
  //   - `in-process` (or anything unrecognised): the loop below.
  //
  // Names are normalised, so a pre-rename `local`/`runtime`/`agentcore`
  // in an old row or in VOCION_AGENT_PROVIDER still resolves. An agent
  // that named nothing gets a target derived from its `modelProvider`
  // — see `defaultHarnessTargetFor`.
  // Each card a past turn put up replays as what its proposal is NOW — run,
  // failed, still waiting — not as the turn stored it (conversation 360: two
  // cards that had started the build replayed as undecided duplicates).
  const conversationHistory = await withLiveCardState(opts.orgId, opts.conversationHistory);
  const [agentRow] = await db
    .select({ harnessConfig: agentSchema.harnessConfig, systemPrompt: agentSchema.systemPrompt })
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, opts.orgId), eq(agentSchema.slug, opts.agentSlug)));
  const harness = agentRow?.harnessConfig;
  // A model override pins the turn to the in-process loop, whatever the agent's
  // harness says — see the option's doc comment.
  const target = opts.modelOverride
    ? 'in-process'
    : normalizeHarnessTarget(process.env.VOCION_AGENT_PROVIDER)
      ?? normalizeHarnessTarget(harness?.runsOn ?? harness?.provider)
      ?? defaultHarnessTargetFor(harness?.modelProvider)
      ?? fleetDefaultHarnessTarget();
  if (target === 'agentcore-container' && process.env.VOCION_DISABLE_RUNTIME !== '1') {
    const { runAgentOnRuntime } = await import('./agents/providers/runtime');
    return runOutOfProcess(opts, emit, run => runAgentOnRuntime({ ...opts, conversationHistory: flatHistory(conversationHistory), onEvent: run }));
  }
  if (target === 'external-worker') {
    // ADR 0004: Vocion is the control plane, a process it does not host does the
    // work. This queues a worker_run and returns a receipt instead of a turn.
    // No turn happened, so nothing is owed: the guarantees do not apply.
    const { queueExternalWorkerTurn } = await import('./agents/providers/externalWorker');
    return queueExternalWorkerTurn(opts);
  }
  if (target === 'aws-managed-harness' && process.env.VOCION_DISABLE_AGENTCORE !== '1') {
    const { runAgentOnAgentCoreHarness } = await import('./agents/providers/agentcore');
    return runOutOfProcess(opts, emit, run => runAgentOnAgentCoreHarness({ ...opts, conversationHistory: flatHistory(conversationHistory), onEvent: run }));
  }

  // The person's per-thread choice of model and thinking, mapped onto the
  // agent's own vendor. Nothing to do when they left both at the default.
  // Dynamic imports, like the harness itself: the Temporal worker reaches
  // this file and must never statically load the LLM module.
  const { chatModelOptionsFor, chatModelOptionsWithOverride } = await import('./agents/harness');
  const { resolvedModelId, resolvedModelIdFor, resolveProvider } = await import('@/libs/llm/langchain');
  const modelOverride = opts.modelOverride ?? modelOverrideForPrefs(harness ?? {}, opts.modelPrefs, { provider: resolveProvider('main'), defaults: chatModelOptionsFor(harness ?? {}), modelFor: resolvedModelIdFor });

  // The graph and its tools are compiled for THIS turn, on this person's
  // context. Nothing here is shared with a turn running beside it — which is
  // what a shared, overwritten context cost us (harness.ts, issue #109).
  let compiled = await compileAgentForRequest(
    opts.orgId,
    opts.agentSlug,
    {
      emit,
      userId: opts.userId,
      allowedSourceSlugs: opts.allowedSourceSlugs,
      missionSlug: opts.missionSlug,
      missionRunId: opts.missionRunId,
      conversationId: opts.conversationId,
      pageContext: opts.pageContext,
      turnMessage: opts.message,
      timeZone: opts.timeZone,
    },
    { modelOverride },
  );
  const boundCtx = compiled.ctx;

  const toolCallLog: Array<{ tool: string; input: Record<string, unknown>; output: string }> = [];
  // Full (untruncated) tool outputs — the sanitizer needs the whole thing to
  // strip a verbatim echo (toolCallLog truncates for the event/audit surface).
  const rawToolOutputs: string[] = [];
  // Tools that FAILED this turn, and delegations that failed specifically.
  // Both were previously invisible past the live rail: a caught tool error
  // rendered as an ordinary "Used X" row, and an uncaught one ended the run
  // with a trace whose last word was "Delegating…".
  const failures: TurnFailure[] = [];
  const failedDelegations: FailedDelegation[] = [];

  // Reads the caps again after every charged model call and, once one is
  // crossed, stops the stream before the next model call — the preflight above
  // only sees the turn's start, and a long turn used to spend past its cap
  // until it finished (#272). A turn that crossed on its final answer keeps it.
  const budgetGuard = new TurnBudgetGuard(opts.orgId, opts.agentSlug);
  // A TURN ENDS. Walk 15's third turn (2026-09-25, conversation 217) never
  // persisted: a model call that never returned held the route's finally,
  // and the row, for as long as the process lived (finding 22). The graph
  // runs under the budget signal AND a wall-clock deadline; past it the turn
  // ends incomplete with what it said so far, and says why.
  const deadlineMs = turnDeadlineMs();
  const deadline = AbortSignal.timeout(deadlineMs);
  const turnSignal = AbortSignal.any([budgetGuard.signal, deadline]);

  // What this run cost, summed over every model turn the callback sees.
  const usage: RunUsage = { model: '', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, microCents: 0, cents: 0, turns: 0 };

  // Langfuse trace via the v0.2 BaseCallbackHandler adapter.
  const { handler: langfuseHandler, trace } = createLangfuseCallback({
    feature: FEATURES.AGENT_CHAT,
    slug: compiled.agentRow.slug,
    orgId: opts.orgId,
    userId: opts.userId ?? 'system',
    input: { message: opts.message },
    metadata: { agentId: compiled.agentRow.id, runtime: 'deepagents' },
    onTurnEnd: async (turn) => {
      addTurnToRunUsage(usage, turn);
      try {
        await chargeUsage({
          orgId: opts.orgId,
          agentSlug: opts.agentSlug,
          model: turn.model,
          usage: {
            inputTokens: turn.inputTokens,
            outputTokens: turn.outputTokens,
            cacheReadTokens: turn.cacheReadTokens,
            cacheWriteTokens: turn.cacheWriteTokens,
          },
        });
      } finally {
        // Even when the charge could not be written (it logs the lost spend
        // itself): the earlier calls' charges may already be over the cap.
        // A call that did not say whether it asked for tools is taken to go
        // on: stopping a turn that was done costs an answer, letting one run
        // on costs a model call per step.
        await budgetGuard.afterModelCall({ turnGoesOn: turn.askedForTools !== false });
      }
    },
  });

  // Link tool_call rows to this turn's trace — cost and latency are read there.
  boundCtx.traceId = trace.id;

  emit({ type: 'thinking' });
  {
    // Say which model answers, so the turn can show it (principle 10).
    const chosen = chatModelOptionsWithOverride(harness ?? {}, modelOverride);
    const provider = chosen.provider ?? resolveProvider('main');
    // The abstract levels are what the person sees; the concrete id is a detail they can expand.
    emit({ type: 'run_meta', model: chosen.model ?? resolvedModelId('main'), provider, strength: opts.modelPrefs?.strength ?? 'balanced', thinking: opts.modelPrefs?.effort ?? 'off' });
  }

  const initialFiles = await buildInitialFiles(opts.orgId, opts.agentSlug, { userId: opts.userId, missionSlug: opts.missionSlug });

  // Silent signal for the adoption surfaces; the chat consumer's event switch
  // has no case for it, so the transcript is untouched.
  const { memoryMountPaths } = await import('./agents/memoryDigest');
  const memoryPaths = memoryMountPaths(initialFiles);
  if (memoryPaths.length > 0) {
    emit({ type: 'memories_mounted', paths: memoryPaths });
  }

  // A past agent turn is replayed as what it DID — its tool calls, each
  // result, the card it put up — then what it said, so the model binds
  // "approve" to a call it made and never re-plans a lookup it already ran
  // (`services/chat/historyTools.ts`). A person's turn is their words.
  const { AIMessage, HumanMessage, ToolMessage } = await import('@langchain/core/messages');
  const history = (conversationHistory ?? [])
    .filter(t => t.content.trim().length > 0 || t.runs)
    .flatMap((t): BaseMessage[] => {
      if (t.role === 'user') {
        return [new HumanMessage(t.content)];
      }
      return historyMessages(t).map(m => m.role === 'tool'
        ? new ToolMessage({ content: m.content, tool_call_id: m.toolCallId, name: m.name })
        : new AIMessage({ content: m.content, tool_calls: m.toolCalls.map(c => ({ id: c.id, name: c.name, args: c.args, type: 'tool_call' as const })) }));
    });

  // The agent's system prompt is supplied to the graph via createDeepAgent's
  // `systemPrompt` (see runtime.ts). It must NOT also appear here — deepagents
  // prepends its own system message, so a second one is rejected by the model.
  // With attachments the user turn is content blocks — the message and each
  // document's text, then the images; without, the plain string it always was.
  const { composeUserContent } = await import('./chat/attachments');
  // NOW rides on the turn, not in the (cached) system prompt — see the CLOCK
  // note in `harness.ts`. The person's zone, UTC beside it, the day named.
  const clock = clockLine(new Date(), boundCtx.timeZone ?? DEFAULT_TIME_ZONE);
  const userContent = await composeUserContent(`${clock}\n\n${opts.message}`, opts.attachments ?? []);
  const input = {
    messages: [
      ...history,
      { role: 'user', content: userContent },
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
  // AnswerStreamer, which strips every <scratch>…</scratch> block — leading
  // or, since 2026-09-20, opened mid-reply after a tool call — and routes it
  // to the trace as reasoning, so raw data never dumps into the answer. No
  // post-run buffering.
  const answerStreamer = new AnswerStreamer();
  // Tool calls the model wrote as text (`<recommend_action>{…}</recommend_action>`),
  // held back by the streamer and executed as the real tool after the loop
  // (`services/agents/textToolCalls.ts`, conversation 355).
  const textCalls: import('./agents/textToolCalls').TextCall[] = [];
  let answering = false;
  // THE INVARIANT: a turn ends with words after its last tool call. False
  // from a tool result until the next answer text; a turn that ends false
  // (production turn 579, 2026-09-24: six lookups after a self-correction,
  // then silence) owes an answer whatever its length says.
  let answeredSinceTool = true;
  // A malformed tool call is retried once, not fatal — see the catch below.
  let toolErrorRetried = false;
  let thoughtOnlyRetried = false;
  // The late narrated-call re-entry runs at most once (see below).
  let narratedNudged = false;
  // Set while the mid-sentence continuation streams (see below).
  let continuationJoin: import('./agents/truncation').ContinuationJoin | null = null;
  // A RE-ENTRY CARRIES WHAT THE TOOLS RETURNED. `runGraph` starts a fresh
  // graph from text messages, so the previous pass's tool calls and results
  // were not in the new pass's context at all: mission run 5081 (2026-09-25,
  // backlog 006) — "no read ever returned — my context holds the mission
  // brief and nothing from the record" — read the same record four times
  // across passes and never wrote. Every re-entry's instruction now ends with
  // the turn's tool results, capped the way the answer pass caps them.
  const withResults = (instruction: string): string => (toolCallLog.length === 0
    ? instruction
    : `${instruction}\n\nWhat your tool calls in this turn returned (they ran; do not repeat them):\n\n${evidenceBlock(toolCallLog)}`);
  // A RE-ENTRY CONTINUES THE REAL CONVERSATION. Conversation 384
  // (2026-09-29): the results above were pasted back as text shaped
  // `### tool {input}` + output, and the model — which still held its tools —
  // wrote more of that shape instead of calling them, inventing a wiki page
  // and five requests the answer then recommended building on. When the
  // graph's own messages are in hand (each pass's final state: the model's
  // messages with their tool calls, and the tool results), the next pass
  // continues from them: results arrive in the tool channel they came from,
  // and there is no text shape to imitate. The pasted form stays only as the
  // fallback for a pass that ended without a state.
  let graphMessages: unknown[] | null = null;
  const continueWith = (instruction: string, fallback: unknown[]): unknown[] => (graphMessages
    ? [...graphMessages, { role: 'user', content: instruction }]
    : [...fallback, { role: 'user', content: withResults(instruction) }]);
  // What is waiting on the person on this page and in this thread — the
  // page record's open asks and pending proposals, and the cards still up in
  // the replay. Read when a pass needs it, fresh each time (a decision in
  // the turn changes it).
  const turnDecisions = async (): Promise<import('./agents/owedDecision').OpenDecision[]> => {
    const target = owedChangeTarget(opts.pageContext?.record);
    return mergeDecisions(target ? await openDecisionsOn(opts.orgId, target.id) : [], pendingCards(conversationHistory ?? []));
  };
  // The lead's most recent model-turn namespace, so a scratch tail released
  // at flush lands on the reasoning node of the turn that wrote it.
  let leadNs = '';
  const routeScratch = (scratch: string, closed: boolean): void => {
    if (scratch) {
      emit({ type: 'thinking_delta', delta: scratch });
      for (const node of tracer.reasonDelta(leadNs, scratch)) {
        emit(node);
      }
    }
    if (closed) {
      for (const node of tracer.closeReasoning()) {
        emit(node);
      }
    }
  };
  // Step names from a cheap model (`stepLabeler.ts`), one job per tool
  // start; each lands as a `trace_node` patch when it resolves. Awaited
  // briefly at the end so the persisted trace carries the names too.
  const labelJobs: Promise<void>[] = [];
  // Unset leaves deepagents' own recursionLimit in charge — see stepLimit.ts.
  const maxSteps = compiled.agentRow.harnessConfig?.maxSteps;

  // The loop, as a function, so a turn that ended on a promise can re-enter
  // it ONCE with the promise as the assistant's own last words (see below).
  const runGraph = async (graphInput: typeof input): Promise<void> => {
    const stream = await compiled.graph.streamEvents(graphInput as never, {
      version: 'v2',
      callbacks: [langfuseHandler, new BudgetGateCallback(budgetGuard)],
      signal: turnSignal,
      ...stepLimitStreamConfig(maxSteps),
    } as never);

    for await (const evUnknown of stream as AsyncIterable<RawStreamEvent>) {
      const ev = evUnknown;
      // The pass's final state, for the next re-entry to continue from.
      if (ev.event === 'on_chain_end' && ((ev as { parent_ids?: unknown[] }).parent_ids ?? []).length === 0) {
        const state = ev.data?.output as { messages?: unknown[] } | undefined;
        if (Array.isArray(state?.messages) && state.messages.length > 0) {
          graphMessages = state.messages;
        }
      }

      // 1) Typed trace nodes for the UI (reason/tool/skill/search/delegate + citations).
      const nodes = tracer.handle(ev);
      for (const node of nodes) {
        emit(node);
      }
      // "Composing render_document…" while a long tool call is still streaming.
      for (const side of tracer.takeSideEvents()) {
        emit(side);
      }
      if (ev.event === 'on_tool_start') {
        for (const node of nodes) {
          if (node.status === 'start' && tracer.wantsLabels(node.id)) {
            const tool = ev.name ?? 'tool';
            const args = parseJsonArgs(ev.data?.input);
            labelJobs.push(labelStep({ orgId: opts.orgId, tool, args }).then((labels) => {
              const patch = tracer.applyLabels(node.id, labels);
              if (patch) {
                emit(patch);
              }
            }).catch(() => {}));
          }
        }
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
            leadNs = nsFor(ev);
            const { answer, thinking: scratch, closed, calls } = answerStreamer.push(text);
            textCalls.push(...calls);
            routeScratch(scratch, closed);
            if (answer) {
              answeredSinceTool = true;
              if (!answering) {
                answering = true;
                emit({ type: 'answering' });
                // Reasoning is over once the answer begins — close open reason
                // nodes so they stop spinning "Thinking" during the tail.
                for (const node of tracer.closeReasoning()) {
                  emit(node);
                }
              }
              // A continuation that restarts inside what was already said
              // is joined without the repeat (`ContinuationJoin`).
              const released = continuationJoin ? continuationJoin.push(answer) : answer;
              if (released) {
                finalText += released;
                emit({ type: 'response_delta', delta: released });
              }
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
          // LangGraph's ToolNode catches a throwing tool and hands back an
          // error ToolMessage, so a failure arrives as an ordinary end event.
          // Read the status, or the failure reaches nobody.
          if (toolResultStatus(ev.data?.output) === 'error') {
            const message = toolErrorMessage(outputFull);
            failures.push({ tool, message });
            if (tool === 'task') {
              failedDelegations.push({ name: tracer.delegateName(toolNodeId(nsFor(ev))) ?? 'the specialist', message });
            }
            emit({ type: 'tool_error', tool, message });
          }
          if (tool !== 'task' && !PLUMBING.has(tool)) {
            const input = parseJsonArgs(ev.data?.input);
            // The live event stays short: it streams to the browser on every
            // call. The log keeps the whole output, because an eval check
            // reads it back — a lookup's JSON cut at 2,000 characters no
            // longer parses, and every rule about its records would fail for
            // the cut.
            const outputStr = outputFull.slice(0, 2000);
            emit({ type: 'tool_end', tool, input, output: outputStr });
            toolCallLog.push({ tool, input, output: outputFull });
            answeredSinceTool = false;
          }
          break;
        }
        case 'on_tool_error': {
          // Nothing caught it: LangChain ends this tool's run here and emits
          // no `on_tool_end` at all. This is the event the failed delegation
          // arrived on, and the event nothing used to read.
          const tool = ev.name ?? 'tool';
          if (PLUMBING.has(tool)) {
            break;
          }
          const message = toolErrorMessage(ev.data?.error);
          failures.push({ tool, message });
          if (tool === 'task') {
            failedDelegations.push({ name: tracer.delegateName(toolNodeId(nsFor(ev))) ?? 'the specialist', message });
          }
          emit({ type: 'tool_error', tool, message });
          // On the turn's log as a failed call, so the owed-change pass sees
          // the attempt and no write check counts it as one that landed.
          toolCallLog.push({ tool, input: parseJsonArgs(ev.data?.input), output: `Error: ${message}` });
          break;
        }
        default:
          break;
      }
    }

    // Note: per-actor citations ride on the `trace_node` events (so the trace
    // can show "found by <specialist>"); the Sources drawer keeps using the
    // richer `documents` event the search tool emits via ctx.emit.
  };

  try {
    await runGraph(input);

    // A TURN THAT ENDED ON A PROMISE CONTINUES, ONCE. "Let me look" — and the
    // model ended its turn, zero tool calls (production turn 577, 2026-09-24,
    // Chris: "I see lookup happen. Then end!?!"). The answer pass can only
    // compose from what the tools found, and here nothing was found. So the
    // loop re-enters with the promise as the assistant's own last words and
    // one instruction: do what you said, now, and answer. Tools are on.
    // Bounded to one continuation; after that the answer pass says what it
    // honestly can.
    {
      const held = answerStreamer.flush();
      textCalls.push(...held.calls);
      routeScratch(held.thinking, false);
      if (held.answer) {
        finalText += held.answer;
        emit({ type: 'response_delta', delta: held.answer });
      }
      const soFar = normalizeAnswerHtml(finalText).trim();
      // The other way a turn ends without doing what it said: the model
      // writes a tool's NAME as its last word instead of calling it —
      // production turn 595 (2026-09-24) ended "…the card is below.
      // recommend_action" and no card existed. That word is not an answer
      // either; it is stripped, and the loop re-enters once to make the call.
      const narrated = NARRATED_TOOL.exec(soFar);
      // The seventh shape: NOTHING — no words, no tool call, no error
      // (reference run 4, cases 1, 8 and 13: an empty completion the loop
      // accepted). An empty turn is not an answer either.
      const empty = soFar.length === 0 && toolCallLog.length === 0;
      // A FRAGMENT IS NOT AN ANSWER. Conversation 382 (2026-09-29): after a
      // full reasoning pass the model's whole reply was "Pic" — three
      // characters, no sentence — and the turn was saved complete. A few
      // characters with no sentence end is continued like an empty turn. The
      // words stay as written: the turn goes on, the copy is not edited
      // (Chris, 2026-09-29: never post-process the copy).
      const fragment = soFar.length > 0 && soFar.length < 16 && !/[.!?)\]*`]$/.test(soFar);
      const callsBeforeContinuation = toolCallLog.length;
      // THE EIGHTH SHAPE: an answer that explains, then ENDS on the move it
      // announces — "Let me write the plan now." — after the person said
      // what to do ("approve, fix and run", conversation 378, 2026-09-29).
      // Every sentence is not a promise, so `preambleOnly` let it through;
      // the last one is, and the person asked for the act, not the plan of
      // it. A call the model wrote out as text is the act, and runs below.
      const announced = !empty && !narrated && !preambleOnly(soFar) && textCalls.length === 0 && asksForAction(opts.message) ? announcedAction(soFar) : null;
      const continued = empty || fragment || (soFar.length > 0 && (preambleOnly(soFar) || narrated || announced !== null));
      if (continued) {
        const narratedName = narrated ? (narrated[1] ?? narrated[2] ?? narrated[3] ?? 'a tool') : null;
        const why = empty ? 'returned nothing' : fragment ? `returned a fragment ("${soFar}")` : narratedName ? `wrote the tool's name "${narratedName}" instead of calling it` : announced ? 'announced an action it did not take' : 'ended on a promise';
        console.warn(`agent turn: ${why}, continuing once`, { orgId: opts.orgId, agentSlug: opts.agentSlug, toolCalls: toolCallLog.length, text: soFar.slice(0, 80) });
        emit({ type: 'status', label: narrated ? `Making the ${narratedName} call it described` : toolCallLog.length > 0 ? `Reading what ${toolCallLog.length} step${toolCallLog.length === 1 ? '' : 's'} found` : 'Looking up what it needs' });
        if (narrated) {
          narratedNudged = true;
          finalText = finalText.replace(NARRATED_TOOL_TAIL, '');
        }
        finalText += '\n\n';
        emit({ type: 'response_delta', delta: '\n\n' });
        // What is waiting on the person, so "approve" meets the call that decides it.
        const waiting = announced ? await turnDecisions() : [];
        const nudge = empty || fragment
          ? 'You returned nothing — no words and no tool call. Answer the person now: run the lookups you need and reply in one screen.'
          : announced
            ? `You ended your turn on "${announced}" — an announcement, not the action — and the person told you what to do: "${personWords(opts.message).slice(0, 300)}". Do it now, with your tools: make the calls it takes${waiting.length > 0 ? `; what is waiting on them, and the call that decides each:\n${describeOpenDecisions(waiting)}\n` : '. '}Then say in one screen what you did and what it started. Do not repeat that sentence, and never write a tool call as text.`
            : narrated
              ? `Your last message wrote "${narratedName}" as text — the name of a tool, or a block shaped like a call — instead of calling it. Call ${narratedName} now with the arguments your message described, then reply in one sentence. Never write a tool call as text.`
              : `You wrote only "${soFar.slice(0, 200)}" and ended your turn. That is a promise, not an answer. Do what you said — run the lookups you need — and answer now, in one screen. Do not repeat that sentence.`;
        await runGraph({
          ...input,
          messages: continueWith(nudge, [...input.messages, ...(empty || fragment ? [] : [{ role: 'assistant', content: narrated ? soFar.replace(NARRATED_TOOL_TAIL, '').trim() : soFar }])]),
        } as typeof input);
      }
      // A CONTINUATION THAT WORKED AND STOPPED AGAIN KEEPS GOING. The one
      // continuation does the reads it promised and then the turn ends on a
      // tool result — no write, no words — and the tool-less answer pass
      // composes the rest. With no tools it can only describe the write: on
      // mission run 5074 (2026-09-25, backlog 006) it wrote the whole
      // update_object payload out and said "The call returned. Fields
      // written", and nothing was. While the last pass made progress (new
      // tool calls) and ended on a tool result, the loop re-enters, at most
      // twice more; a pass that makes no call, or answers, ends it.
      if (continued) {
        let mark = callsBeforeContinuation;
        for (let extra = 0; extra < 2; extra++) {
          const progressed = toolCallLog.length > mark;
          if (!progressed || answeredSinceTool) {
            break;
          }
          mark = toolCallLog.length;
          console.warn('agent turn: the continuation worked and stopped on a tool result; once more', { orgId: opts.orgId, agentSlug: opts.agentSlug, toolCalls: toolCallLog.length, extra: extra + 1 });
          emit({ type: 'status', label: 'Making the change it owes' });
          await runGraph({
            ...input,
            messages: continueWith('You have the results of the reads you just made. Now do what the person asked — make the write (call the tool) if one is owed — and then answer in one screen. Do not read again what you already read. Never write a tool call as text.', [...input.messages, ...(normalizeAnswerHtml(finalText).trim() ? [{ role: 'assistant', content: normalizeAnswerHtml(finalText).trim() }] : [])]),
          } as typeof input);
        }
      }
      // AN ANSWER CUT OFF MID-SENTENCE is not an answer (mission run 5364,
      // 2026-09-26: the QA verdict ended at "Head read at `"). Once, the
      // turn re-enters with where it stopped and finishes from there.
      {
        const { ContinuationJoin, cutOffMidSentence } = await import('./agents/truncation');
        const shown = normalizeAnswerHtml(finalText).trim();
        if (cutOffMidSentence(shown) && !NARRATED_TOOL.test(shown)) {
          console.warn('agent turn: the answer stopped mid-sentence; finishing it', { orgId: opts.orgId, agentSlug: opts.agentSlug, tail: shown.slice(-80) });
          emit({ type: 'status', label: 'Finishing the answer' });
          continuationJoin = new ContinuationJoin(finalText);
          try {
            await runGraph({
              ...input,
              messages: continueWith(`Your answer stopped mid-sentence at "${shown.slice(-120)}". Continue exactly from where it stopped and finish it. Do not repeat what you already wrote and do not read again what you already read.`, [...input.messages, { role: 'assistant', content: shown }]),
            } as typeof input);
          } finally {
            const held = continuationJoin.flush();
            continuationJoin = null;
            if (held) {
              finalText += held;
              emit({ type: 'response_delta', delta: held });
            }
          }
        }
      }
      // A CALL WRITTEN OUT AFTER THE CONTINUATION. The one continuation can
      // be spent on a preamble ("I'll start by reading the request"), and the
      // pass it buys then does the reads and WRITES the write as a heading
      // over a JSON block — mission run 5067 (2026-09-25, backlog 006):
      // "**update_object** — request #30", the full payload, "Calling
      // update_object now", and no call. Nothing looked at the text a second
      // time, so the row stayed empty. When the answer now ends in a call to
      // a tool that was not the last one made, the loop re-enters once more,
      // naming the tool.
      {
        const tail = normalizeAnswerHtml(finalText).trim();
        const late = NARRATED_TOOL.exec(tail);
        const lateName = late ? (late[1] ?? late[2] ?? late[3] ?? null) : null;
        if (lateName && !narratedNudged && toolCallLog.at(-1)?.tool !== lateName) {
          narratedNudged = true;
          finalText = finalText.replace(NARRATED_TOOL_TAIL, '');
          console.warn(`agent turn: wrote a ${lateName} call out after continuing; once more to make it`, { orgId: opts.orgId, agentSlug: opts.agentSlug, toolCalls: toolCallLog.length });
          await runGraph({
            ...input,
            messages: continueWith(`Your last message wrote a ${lateName} call out as text instead of calling it, so nothing was written. Call ${lateName} now with exactly the arguments your message described, then reply in one sentence. Never write a tool call as text.`, [...input.messages, { role: 'assistant', content: tail }]),
          } as typeof input);
        }
      }
      // THOUGHT, AND SAID NOTHING. A turn that ends with no words and no tool
      // call after the continuation is the model spending its whole output
      // on thinking (MCP turns 667 and 675, 2026-09-25: two reasoning nodes,
      // zero characters, twice). The words are not coming from that
      // configuration: compile once more with thinking off and run again.
      const stillEmpty = normalizeAnswerHtml(finalText).trim().length === 0 && toolCallLog.length === 0 && emittedCards.length === 0;
      if (stillEmpty && !thoughtOnlyRetried) {
        thoughtOnlyRetried = true;
        console.warn('agent turn: thought and said nothing; once more without thinking', { orgId: opts.orgId, agentSlug: opts.agentSlug });
        compiled = await compileAgentForRequest(
          opts.orgId,
          opts.agentSlug,
          {
            emit,
            userId: opts.userId,
            allowedSourceSlugs: opts.allowedSourceSlugs,
            missionSlug: opts.missionSlug,
            missionRunId: opts.missionRunId,
            conversationId: opts.conversationId,
            pageContext: opts.pageContext,
            turnMessage: opts.message,
            timeZone: opts.timeZone,
          },
          // A ModelOverride names its model; without one the provider lookup
          // trims undefined and the turn dies (MCP turn, 2026-09-25 04:26Z,
          // finding 25). The retry keeps the model the turn already chose.
          { modelOverride: { ...(modelOverride ?? {}), model: modelOverride?.model ?? chatModelOptionsFor(harness ?? {}).model ?? resolvedModelId('main'), ...((modelOverride?.provider ?? chatModelOptionsFor(harness ?? {}).provider) ? { provider: modelOverride?.provider ?? chatModelOptionsFor(harness ?? {}).provider } : {}), thinking: 'off' } },
        );
        await runGraph({
          ...input,
          messages: continueWith('Your last two attempts produced no words and no tool calls. Answer now in plain text, or make the tool calls you need — say what you found and what you did.', [...input.messages]),
        } as typeof input);
      }
    }

    // Give late step names a moment to land before the turn closes, so the
    // persisted trace reads like the live one did. Never more than a beat.
    if (labelJobs.length > 0) {
      await Promise.race([Promise.allSettled(labelJobs), new Promise(r => setTimeout(r, 1500))]);
    }
  } catch (caught) {
    let err: unknown = caught;
    let recovered = false;
    // A MALFORMED TOOL CALL IS NOT THE END OF THE TURN. deepagents' own tools
    // throw on a schema miss and the throw leaves the graph (verified live,
    // harness.ts); production turn 614 (2026-09-24) died on `read_file`
    // called with no arguments — the person saw one preamble and "incomplete".
    // The error goes back to the model once, as the instruction, tools on.
    if (isToolInputError(caught) && !toolErrorRetried) {
      toolErrorRetried = true;
      const detail = (caught as Error).message.replace(/\s+/g, ' ').slice(0, 300);
      console.warn('agent turn: malformed tool call, continuing once', { orgId: opts.orgId, agentSlug: opts.agentSlug, detail });
      try {
        const soFar = normalizeAnswerHtml(finalText).trim();
        await runGraph({
          ...input,
          messages: continueWith(`Your last tool call was rejected: ${detail}. Call it again with valid arguments, or do without it — and answer. Do not stop.`, [...input.messages, ...(soFar ? [{ role: 'assistant', content: soFar }] : [])]),
        } as typeof input);
        recovered = true;
      } catch (again) {
        err = again;
      }
    }
    if (!recovered) {
    // A budget stop ends the turn as a refusal carrying the cap that was hit —
    // whatever the aborted stream threw on its way out. A step-limit stop is
    // reworded for the person; anything else keeps its own message.
      const budgetStop = budgetGuard.stopError();
      if (budgetStop) {
      // Almost always the abort itself; logged in case something else broke
      // as the stop landed, since the person only sees the budget message.
        console.warn('agent turn: stopped at its budget', { orgId: opts.orgId, agentSlug: opts.agentSlug, thrown: err instanceof Error ? err.message : String(err) });
      }
      if (!budgetStop && deadline.aborted) {
        console.warn('agent turn: ran past the deadline and was stopped', { orgId: opts.orgId, agentSlug: opts.agentSlug, deadlineMs, toolCalls: toolCallLog.length, textChars: finalText.length });
      }
      const { message, rethrow } = budgetStop
        ? { message: budgetStop.message, rethrow: budgetStop }
        : deadline.aborted
          ? { message: `the turn ran past the ${Math.round(deadlineMs / 60_000)}-minute limit and was stopped; what it said so far is kept`, rethrow: new Error(`the turn ran past the ${Math.round(deadlineMs / 60_000)}-minute limit and was stopped`) }
          : describeTurnFailure(err, maxSteps);
      // The run died. Close anything still open as a FAILURE first, so the
      // persisted trace carries a terminal node instead of stopping at
      // "Delegating to <specialist>" — the exact trace this turn used to leave.
      const stillDelegating = tracer.openDelegationNames();
      for (const node of tracer.closeDelegations(message)) {
        emit(node);
      }
      for (const name of stillDelegating) {
        if (!failedDelegations.some(f => f.name === name)) {
          failedDelegations.push({ name, message });
        }
        emit({ type: 'tool_error', tool: 'task', message });
      }
      // There will be no answer, so the words have to go into the transcript
      // here — a badge in the trace is not the person being told.
      const notice = delegationFailureNotice(failedDelegations, finalText);
      if (notice) {
        emit({ type: 'response_delta', delta: `${finalText.trim().length > 0 ? '\n\n' : ''}${notice}` });
      }
      emit({ type: 'error', message });
      trace.update({ output: { error: message } });
      await flushTraces();
      throw rethrow;
    }
  }

  // Release any held-back tail (partial-tag boundary) from the streamer. A
  // block still open here was cut off by the end of the stream: it is
  // thinking to its last character, and its reasoning node closes with it.
  const tail = answerStreamer.flush();
  textCalls.push(...tail.calls);
  routeScratch(tail.thinking, true);
  if (tail.answer) {
    finalText += tail.answer;
    emit({ type: 'response_delta', delta: tail.answer });
  }
  finalText = normalizeAnswerHtml(finalText).trim();
  // A TOOL CALL WRITTEN AS TEXT IS STILL THE CALL (conversation 355). The
  // streamer held every block back; any that reached the text another way is
  // taken out here. Each runs as the real tool — same validation, trust and
  // card path — and one that cannot is a line under the answer, never JSON.
  {
    const { extractTextCalls, runTextCalls, tidy } = await import('./agents/textToolCalls');
    const left = extractTextCalls(finalText);
    if (left.calls.length > 0) {
      console.warn('agent turn: tool-call blocks left in the answer text', { orgId: opts.orgId, agentSlug: opts.agentSlug, count: left.calls.length });
      finalText = left.text;
      textCalls.push(...left.calls);
    }
    if (textCalls.length > 0) {
      finalText = tidy(finalText);
      try {
        const { buildDomainTools } = await import('./agents/tools/registry');
        const ran = await runTextCalls(textCalls, buildDomainTools(boundCtx));
        for (const o of ran.outcomes) {
          toolCallLog.push({ tool: o.tag, input: o.input, output: o.output.slice(0, 2000) });
          emit({ type: 'tool_start', tool: o.tag, input: o.input });
          emit(o.ok ? { type: 'tool_end', tool: o.tag, input: o.input, output: o.output.slice(0, 2000) } : { type: 'tool_error', tool: o.tag, message: o.output.slice(0, 500) });
        }
        // What could not run is on the trace (the tool_error above) and in
        // the log, never a line in the reply.
        console.warn('text tool calls', { orgId: opts.orgId, agentSlug: opts.agentSlug, blocks: textCalls.length, ran: ran.outcomes.filter(o => o.ok).length, dropped: ran.notes });
      } catch (err) {
        console.warn('text tool calls failed', { orgId: opts.orgId, agentSlug: opts.agentSlug, message: (err as Error).message });
      }
    }
  }
  // Whatever happened above, a tool's bare name is never the last word of an
  // answer: if the continuation narrated it again, it goes, and the log says so.
  if (NARRATED_TOOL.test(finalText)) {
    console.warn('agent turn: narrated tool name stripped from the answer', { orgId: opts.orgId, agentSlug: opts.agentSlug });
    finalText = finalText.replace(NARRATED_TOOL_TAIL, '').trim();
  }
  // THE PERSON ASKED FOR A RECORD; THE TURN ENDS WITH ONE. Conversation 349
  // (2026-09-28): "File a feature request…", a broken call, no retry; then
  // "Please file it now." and no call at all — two turns, no record. When the
  // person's own words ask for a filing and nothing was written, one pass
  // with propose_action chosen files it from the conversation
  // (`services/agents/owedWriteBackstop.ts`), before the claim check below
  // reads the turn.
  // The filing receipt waits until the answer is final: an answer that names
  // the record needs no second announcement of it (journey 4: "Filed from
  // this conversation: request #214." over "Filed as request #214.").
  let owedReceipt: { line: string; output: string } | null = null;
  if (asksToFile(opts.message) && !wroteInTurn(toolCallLog)) {
    try {
      const { buildDomainTools } = await import('./agents/tools/registry');
      // The typed filing tool when the agent has one (file_request), so the
      // pass fills the type's own schema; else propose_action (conversation 353).
      const history = opts.conversationHistory ?? [];
      const proposeTool = owedWriteTool(buildDomainTools(boundCtx), [opts.message, ...history.map(t => t.content)].join('\n'));
      if (proposeTool) {
        emit({ type: 'status', label: 'Filing what you asked for' });
        const { buildChatModelForOrg } = await import('@/libs/llm');
        const model = await buildChatModelForOrg('extractor', opts.orgId, { temperature: 0, streaming: false, maxTokens: 6000 });
        const owed = await fileOwedWrite({
          request: opts.message,
          history: history.map(t => ({ role: t.role, content: t.content })),
          answer: finalText,
          systemPrompt: compiled.agentRow.systemPrompt ?? undefined,
          tool: proposeTool,
          model: model as never,
        });
        console.warn('owed write pass', { orgId: opts.orgId, agentSlug: opts.agentSlug, conversationId: opts.conversationId ?? null, filed: owed.filed, output: owed.output.slice(0, 200) });
        if (owed.args) {
          toolCallLog.push({ tool: proposeTool.name, input: owed.args, output: owed.output });
          // The step is on the turn like any call: a recovered failure then
          // reads "retried · filed", not "file_request failed" (journey 4).
          emit({ type: 'tool_start', tool: proposeTool.name, input: owed.args });
          emit(owed.filed ? { type: 'tool_end', tool: proposeTool.name, input: owed.args, output: owed.output.slice(0, 2000) } : { type: 'tool_error', tool: proposeTool.name, message: owed.output.slice(0, 500) });
        }
        if (owed.line) {
          owedReceipt = { line: owed.line, output: owed.output };
        }
      }
    } catch (err) {
      // A backstop never fails the turn; the claim check still tells the truth.
      console.warn('owed write pass failed', { orgId: opts.orgId, agentSlug: opts.agentSlug, message: (err as Error).message });
    }
  }

  // THE PERSON ASKED TO CHANGE THE RECORD ON THEIR PAGE; THE TURN ENDS WITH
  // IT CHANGED (journey 4, request #214: "Change this request: …" read the
  // record, claimed "Updated", wrote nothing). One pass with update_object
  // chosen, the page's record fixed (`owedWriteBackstop.changeOwedRecord`).
  const pageRecord = opts.pageContext?.record;
  const owedTarget = owedChangeTarget(pageRecord);
  const pageRecordId = owedTarget?.id ?? null;
  // Asked for in the person's words, or claimed in the answer: "two edits
  // written to the record" with no write behind it (conversation 362) is
  // the same owed change, whoever answered on the page.
  if (pageRecordId !== null && (asksToChange(opts.message) || attemptedChange(toolCallLog, pageRecordId) || (writeClaim(finalText) !== null && !wroteInTurn(toolCallLog))) && !changedInTurn(toolCallLog, pageRecordId)) {
    try {
      const { buildDomainTools } = await import('./agents/tools/registry');
      const updateTool = buildDomainTools(boundCtx).find(t => t.name === 'update_object');
      const { getBusinessObject } = await import('./BusinessObjectService');
      // The page's record is writable whatever the agent's objectTypes say (`tools/recordWrite.ts`).
      const { recordWritable } = await import('./agents/tools/recordWrite');
      const row = updateTool ? await getBusinessObject(pageRecordId, opts.orgId) : null;
      // The row's type is the fact; the page's typed ref says the same (a
      // `feature` page opens a request) and stands in when the row has none.
      // The page's record is writable whatever the agent's objectTypes say.
      const typeSlug = row?.type?.slug ?? owedTarget?.objectType ?? null;
      if (updateTool && row && typeSlug && recordWritable(boundCtx, typeSlug, row.id)) {
        emit({ type: 'status', label: `Changing ${typeSlug} #${row.id}` });
        const { recordHref } = await import('./objects/recordHref');
        const href = await recordHref(opts.orgId, { objectType: typeSlug, id: row.id }).catch(() => pageRecord?.href ?? null);
        const { buildChatModelForOrg } = await import('@/libs/llm');
        const model = await buildChatModelForOrg('extractor', opts.orgId, { temperature: 0, streaming: false, maxTokens: 6000 });
        const history = opts.conversationHistory ?? [];
        const changed = await changeOwedRecord({
          request: opts.message,
          history: history.map(t => ({ role: t.role, content: t.content })),
          answer: finalText,
          systemPrompt: compiled.agentRow.systemPrompt ?? undefined,
          record: { id: row.id, typeSlug, label: `${typeSlug.replace(/[_-]+/g, ' ')} #${row.id}`, href, fields: { title: row.title, status: row.status, ...((row.metadata ?? {}) as Record<string, unknown>) } },
          tool: updateTool,
          model: model as never,
        });
        console.warn('owed change pass', { orgId: opts.orgId, agentSlug: opts.agentSlug, conversationId: opts.conversationId ?? null, recordId: row.id, changed: changed.filed, output: changed.output.slice(0, 200) });
        if (changed.args) {
          toolCallLog.push({ tool: updateTool.name, input: changed.args, output: changed.output });
          emit({ type: 'tool_start', tool: updateTool.name, input: changed.args });
          emit(changed.filed ? { type: 'tool_end', tool: updateTool.name, input: changed.args, output: changed.output.slice(0, 2000) } : { type: 'tool_error', tool: updateTool.name, message: changed.output.slice(0, 500) });
        }
        if (changed.line) {
          const delta = `${finalText.trim() ? '\n\n' : ''}${changed.line}`;
          finalText += delta;
          emit({ type: 'response_delta', delta });
        }
      }
    } catch (err) {
      console.warn('owed change pass failed', { orgId: opts.orgId, agentSlug: opts.agentSlug, message: (err as Error).message });
    }
  }

  // THE PERSON SAID WHAT TO DO WITH A DECISION WAITING ON THEM; THE TURN
  // ENDS WITH IT DONE. Conversation 378 (2026-09-29): "approve, fix and run"
  // on request #201's page, a re-dispatch card and a Stopped ask waiting —
  // and the turn ended "Let me write the plan now."; the next ("write it")
  // wrote nothing at all. When the person's words take a decision (this
  // message, or the one before when this one is a bare "write it" / "do
  // it") and the turn decided nothing, one pass with the decide tools bound
  // and a call required carries it out (`agents/owedDecision.ts`). The tools
  // gate on the person's own words, so the pass cannot decide what they did
  // not say.
  if (opts.userId && !opts.missionRunId && !decidedInTurn(toolCallLog)) {
    const previous = [...(opts.conversationHistory ?? [])].reverse().find(t => t.role === 'user')?.content;
    const standing = decisionNamed(opts.message) ?? (asksForAction(opts.message) ? decisionNamed(previous) : null);
    if (standing) {
      try {
        const waiting = await turnDecisions();
        const { buildDomainTools } = await import('./agents/tools/registry');
        const tools = waiting.length > 0 ? buildDomainTools(boundCtx).filter(t => (DECIDE_TOOLS as readonly string[]).includes(t.name) || t.name === 'update_object') : [];
        if (tools.some(t => (DECIDE_TOOLS as readonly string[]).includes(t.name))) {
          emit({ type: 'status', label: 'Doing what you said' });
          const { buildChatModelForOrg } = await import('@/libs/llm');
          const model = await buildChatModelForOrg('extractor', opts.orgId, { temperature: 0, streaming: false, maxTokens: 4000 });
          const owed = await decideOwed({
            request: opts.message,
            history: (opts.conversationHistory ?? []).map(t => ({ role: t.role, content: t.content })),
            answer: finalText,
            systemPrompt: compiled.agentRow.systemPrompt ?? undefined,
            decisions: waiting,
            tools,
            model: model as never,
          });
          console.warn('owed decision pass', { orgId: opts.orgId, agentSlug: opts.agentSlug, conversationId: opts.conversationId ?? null, standing, waiting: waiting.map(d => `${d.kind}#${d.id}`), calls: owed.calls.map(c => `${c.tool}: ${c.output.slice(0, 120)}`) });
          for (const c of owed.calls) {
            toolCallLog.push({ tool: c.tool, input: c.input, output: c.output });
            emit({ type: 'tool_start', tool: c.tool, input: c.input });
            emit(/^\s*refused\b/i.test(c.output) ? { type: 'tool_error', tool: c.tool, message: c.output.slice(0, 500) } : { type: 'tool_end', tool: c.tool, input: c.input, output: c.output.slice(0, 2000) });
          }
          if (owed.lines.length > 0) {
            const delta = `${finalText.trim() ? '\n\n' : ''}Done as you said: ${owed.lines.map(l => l.replace(/\.$/, '')).join('; ')}.`;
            finalText += delta;
            emit({ type: 'response_delta', delta });
          }
        }
      } catch (err) {
        // A backstop never fails the turn.
        console.warn('owed decision pass failed', { orgId: opts.orgId, agentSlug: opts.agentSlug, message: (err as Error).message });
      }
    }
  }

  // End-of-turn guarantees (structural): a failed hand-off is stated in the
  // answer, and a turn sent with `deliverable: 'artifact'` ends with one.
  const answerPassTools = await (async () => {
    try {
      const { buildDomainTools } = await import('./agents/tools/registry');
      return buildDomainTools(boundCtx).filter(t => t.name === 'recommend_action' || t.name === 'propose_action');
    } catch {
      // No tools, no card calls: the pass still answers in words.
      return [];
    }
  })();
  finalText = await applyTurnGuarantees({
    orgId: opts.orgId,
    agentSlug: opts.agentSlug,
    userId: opts.userId,
    conversationId: opts.conversationId,
    deliverable: opts.deliverable,
    request: opts.message,
    response: finalText,
    toolCalls: toolCallLog,
    cardsShown: emittedCards.length,
    endedOnTool: toolCallLog.length > 0 && !answeredSinceTool,
    failures,
    failedDelegations,
    systemPrompt: compiled.agentRow.systemPrompt ?? undefined,
    history: (opts.conversationHistory ?? []).map(t => ({ role: t.role, content: t.content })),
    emit,
    // The answer pass continues the real conversation and holds the card
    // tools, so a card it means is a real call (conversation 384).
    ...(graphMessages ? { messages: graphMessages } : {}),
    cardTools: answerPassTools,
    onToolCall: async (call) => {
      const tool = answerPassTools.find(t => t.name === call.name);
      if (!tool) {
        return;
      }
      emit({ type: 'tool_start', tool: call.name, input: call.args });
      const output = await tool.invoke({ type: 'tool_call', id: call.id, name: call.name, args: call.args } as never).then(
        r => (typeof r === 'string' ? r : String((r as { content?: unknown }).content ?? '')),
        (err: Error) => `Error: ${err.message}`,
      );
      toolCallLog.push({ tool: call.name, input: call.args, output });
      emit(output.startsWith('Error:') ? { type: 'tool_error', tool: call.name, message: output.slice(0, 500) } : { type: 'tool_end', tool: call.name, input: call.args, output: output.slice(0, 2000) });
    },
  });

  // The filing receipt, only when the answer does not already name the record.
  if (owedReceipt && !answerNamesFiled(finalText, owedReceipt.output)) {
    const delta = `${finalText.trim() ? '\n\n' : ''}${owedReceipt.line}`;
    finalText += delta;
    emit({ type: 'response_delta', delta });
  }

  // A record the turn made is linked at the end if the answer did not give
  // it — read AFTER the answer pass, so a record the answer names by number
  // ("Filed as request #214") is not linked a second time under it; the
  // mention itself becomes the link below (`recordMentionLinks`).
  const unnamed = createdRecords.filter(r => !new RegExp(`#${r.id}(?!\\d)`).test(finalText));
  if (unnamed.length > 0) {
    const linked = appendRecordLinks(finalText, unnamed);
    if (linked !== finalText) {
      emit({ type: 'response_delta', delta: linked.slice(finalText.length) });
      finalText = linked;
    }
  }

  // A record the turn CHANGED is linked to the version the change made, in
  // its history (backlog 035): "Changed …" is one click from how it changed.
  const versionDelta = versionLinksDelta(finalText, writtenVersions);
  if (versionDelta) {
    emit({ type: 'response_delta', delta: versionDelta });
    finalText += versionDelta;
  }

  // Card backstop (structural, workspace-opt-in) — AFTER the guarantees, so
  // it reads the answer the person actually got. It used to run before the
  // answer pass, saw only a short preamble, and never fired on a turn the
  // pass had answered (three PM turns on 2026-09-24, zero cards, no log).: prompt compliance for
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
  let cardsOnScreen = emittedCards.length;
  if (backstopOn && emittedCards.length < 3 && finalText.length > 300) {
    try {
      // TWO STEPS, IN SECONDS (services/agents/cardBackstop.ts): a fast call
      // lists the decisions the answer names, then one call per card writes
      // it, all at once, each card up the moment its own call returns. One
      // sequential call writing every body held the last card ~40s behind
      // the answer (Chris, 2026-09-25 and 2026-09-28).
      const { realCardBackstopDeps, runCardBackstop } = await import('./agents/cardBackstop');
      const out = await runCardBackstop(
        {
          answer: finalText,
          already: [...emittedCards],
          agentPrompt: compiled.agentRow.systemPrompt ?? '',
          // A filing card is written from the conversation, not the answer alone.
          conversation: [...(opts.conversationHistory ?? []).slice(-8).map(t => `${t.role === 'user' ? 'Person' : 'You'}: ${String(t.content ?? '').slice(0, 3_000)}`), `Person: ${opts.message.split('\n\n--- ')[0]!.slice(0, 3_000)}`].join('\n\n'),
          // The person's words this turn: an instruction is never answered with a question card.
          instruction: opts.message,
        },
        await realCardBackstopDeps({ ctx: compiled.ctx, orgId: opts.orgId, agentSlug: opts.agentSlug, userId: opts.userId, emit }),
      );
      cardsOnScreen += out.emitted;
      // A decision that could not be a card is dropped from what the person
      // sees — no dead card, and no "— not a card: its input does not fit…"
      // line under the answer either (Chris, 2026-09-29). Its tool_call row
      // and the log line below keep the reason for whoever debugs it.
      // Say what happened: a silent backstop cannot be told from one that
      // never ran (2026-09-24: eight production turns, zero cards, no way to
      // know which). One line per pass, in the app log.
      console.warn('card backstop', { orgId: opts.orgId, agentSlug: opts.agentSlug, already: emittedCards.length - out.emitted, listed: out.listed, emitted: out.emitted, refused: out.refused, mapped: out.mapped, typed: out.typed ?? 0, drafts: out.drafts ?? 0, repaired: out.repaired ?? 0, dropped: out.notes, textChars: finalText.length });
    } catch (err) {
      /* backstop is best-effort — never fails the turn */
      console.warn('card backstop failed', { orgId: opts.orgId, agentSlug: opts.agentSlug, message: (err as Error).message });
    }
  } else if (emittedCards.length === 0 && finalText.length > 300) {
    console.warn('card backstop skipped', { orgId: opts.orgId, agentSlug: opts.agentSlug, backstopOn, textChars: finalText.length });
  }
  // A card is a tool call, never prose. With a real card on screen, a "CARD —
  // Approve build: …" block the model wrote out by hand (production turn 642,
  // 2026-09-24: the whole card as markdown, then the real one under it) is
  // the same card twice, once un-pressable. It goes; `done` carries the text.
  if (cardsOnScreen > 0 && NARRATED_CARD.test(finalText)) {
    console.warn('agent turn: narrated card stripped from the answer', { orgId: opts.orgId, agentSlug: opts.agentSlug, cardsOnScreen });
    finalText = finalText.replace(NARRATED_CARD, '').trim();
  }

  // A record the answer names ("#201", "request 201") links to its page —
  // live and stored, from one typed event (libs/chat/recordMentions.ts).
  const { recordMentionLinks } = await import('@/services/chat/recordMentionLinks');
  const mentionLinks = await recordMentionLinks(opts.orgId, finalText);
  if (mentionLinks.length > 0) {
    const { linkRecordMentions } = await import('@/libs/chat/recordMentions');
    emit({ type: 'record_links', links: mentionLinks });
    finalText = linkRecordMentions(finalText, mentionLinks);
  }

  trace.update({ output: { response: finalText.slice(0, 500), tool_calls: toolCallLog.length } });

  // The turn is over the moment the answer is: say so BEFORE telemetry.
  //
  // `done` used to wait behind `await flushTraces()`. On a box whose Langfuse
  // host is unreachable the SDK retries for 30–40 seconds, and for all of that
  // time the person watched "Working…" under an answer that had visibly
  // finished (Chris, 2026-09-17: *"why does this show 'working' for so long
  // ... then it stops after like 40 seconds"*). Tracing is a record of the
  // work, not part of it; it never gets to hold the person's turn open.
  emit({ type: 'done', response: finalText, traceId: trace.id });
  await flushTraces();

  recordTurn(opts, recordedEvents, {
    response: finalText,
    traceId: trace.id,
    toolCalls: toolCallLog,
  });

  return {
    response: finalText,
    traceId: trace.id,
    toolCalls: toolCallLog,
    usage,
  };
}

/** Token usage of one `runAgentDeep` call, summed over its model turns. */
export type RunUsage = {
  /** The id the provider reported on the last turn (`unknown` if it named none). */
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Input tokens the vendor served from its prompt cache, at 0.1x the rate. */
  cacheReadTokens: number;
  /** Input tokens the vendor wrote into its prompt cache, at 1.25x the rate. */
  cacheWriteTokens: number;
  /**
   * What the run cost in micro-cents (a millionth of a cent) — the exact
   * number, summed as whole numbers over the run's turns.
   */
  microCents: number;
  /**
   * The same cost in USD cents, for reading. Derived from `microCents`, so it
   * carries a fraction; 0 for a model the price table does not know.
   */
  cents: number;
  /** Model turns — one per LLM call, so retries and tool loops count. */
  turns: number;
};

/**
 * Fold one finished model turn into a run's running total, in place.
 *
 * Lives here rather than inside the callback that calls it so the arithmetic
 * can be read and tested on its own — it decides what the run is charged, and
 * every way of getting it wrong is silent:
 *
 *   - A cache read not counted is a saving nobody can see on the run.
 *   - A cache write not counted undercharges the first turn of every run by
 *     about a quarter, because a written prefix costs 1.25x plain input.
 *   - `cents` is recomputed from the exact micro-cent total rather than added
 *     up turn by turn: most cent amounts are not values a floating-point
 *     number holds exactly, so accumulating them drifts over a long run.
 *
 * `model` is overwritten rather than merged; a run that switches models mid-way
 * is named after its last turn, and each turn is still priced on its own model.
 * @param usage - The run's running total, updated in place.
 * @param turn - What the provider reported for the turn that just finished.
 */
export function addTurnToRunUsage(usage: RunUsage, turn: LangfuseTurnUsage): void {
  usage.turns += 1;
  usage.model = turn.model;
  usage.inputTokens += turn.inputTokens ?? 0;
  usage.outputTokens += turn.outputTokens ?? 0;
  usage.cacheReadTokens += turn.cacheReadTokens ?? 0;
  usage.cacheWriteTokens += turn.cacheWriteTokens ?? 0;
  usage.microCents += tokenCostMicroCents(turn.model, {
    inputTokens: turn.inputTokens,
    outputTokens: turn.outputTokens,
    cacheReadTokens: turn.cacheReadTokens,
    cacheWriteTokens: turn.cacheWriteTokens,
  });
  usage.cents = usage.microCents / 1_000_000;
}

/**
 * The model override a conversation's preferences ask for, on the agent's
 * own vendor — or undefined when they ask for nothing beyond its defaults.
 * @param harness - The agent's harness block.
 * @param prefs - The person's per-thread choice.
 * @param env - The env's main provider, the agent's own model options, and the per-provider default lookup.
 * @param env.provider
 * @param env.defaults
 * @param env.defaults.provider
 * @param env.defaults.model
 * @param env.modelFor
 */
function modelOverrideForPrefs(
  harness: import('./agents/harness').HarnessModelConfig,
  prefs: import('@/libs/llm/modelPrefs').ModelPrefs | undefined,
  env: { provider: import('@/libs/llm/langchain').LangChainProvider; defaults: { provider?: import('@/libs/llm/langchain').LangChainProvider; model?: string }; modelFor: (role: 'main', provider: import('@/libs/llm/langchain').LangChainProvider) => string },
): import('./agents/harness').ModelOverride | undefined {
  void harness;
  if (!prefs || (prefs.strength === 'balanced' && prefs.effort === 'off')) {
    return undefined;
  }
  const provider = env.defaults.provider ?? env.provider;
  // One server-side table maps a level to a model (`libs/llm/modelPrefs.ts`);
  // a deployment can point a level elsewhere with VOCION_MODEL_<LEVEL>_<PROVIDER>
  // (e.g. VOCION_MODEL_DEEP_ANTHROPIC) without touching the table or the UI,
  // which never names a vendor.
  const envModel = prefs.strength === 'balanced' ? undefined : process.env[`VOCION_MODEL_${prefs.strength.toUpperCase()}_${provider.toUpperCase()}`]?.trim();
  const model = envModel || modelForStrength(provider, prefs.strength) || env.defaults.model || env.modelFor('main', provider);
  return { model, provider, thinking: prefs.effort };
}
