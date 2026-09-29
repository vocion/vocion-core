/**
 * THE PERSON SAID WHAT TO DO; THE TURN DOES IT.
 *
 * Conversation 378 (2026-09-29), request #201's feature page. The product
 * manager had put up a re-dispatch card (proposal #5201) and a Stopped ask
 * (#221) was open on the request. The person wrote "approve, fix and run".
 * The turn read one record, explained, and ENDED on "Let me write the plan
 * now." — nothing decided, nothing run. The person wrote "write it". That
 * turn thought three times, wrote nothing a person could read, and a
 * tool-less answer pass with no conversation in front of it answered "I
 * don't have enough context… the tool results came back empty", then a card
 * went up asking the person to approve asking them for context. Chris: "I
 * JUST ASKED VOCION TO DO EXACTLY THAT".
 *
 * Three shapes, one rule — an instruction is carried out, in code:
 *
 *   1. {@link announcedAction}: a turn whose last sentence announces an
 *      action it did not take, when the person asked for action
 *      ({@link asksForAction}), continues once with its tools (the same
 *      re-entry as the other stall shapes in `AgentService`).
 *   2. {@link personSaid}: the person's explicit words are the gate on a
 *      decision taken on their behalf (`decide_proposal`, `decide_ask`) —
 *      never the model's reading of them alone.
 *   3. {@link decideOwed}: when the person's words decide something waiting
 *      on them and the turn decided nothing, one pass with the decide tools
 *      bound and a call REQUIRED carries it out, the way the owed-write pass
 *      files a record (`owedWriteBackstop.ts`).
 */

import type { BaseMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { OwedWriteModel, OwedWriteTurn } from './owedWriteBackstop';

/**
 * The person's own words: the message before the page context the route
 * appends ("--- where I am ---").
 * @param message - The message as the model received it.
 */
export function personWords(message: string | null | undefined): string {
  return ((message ?? '').split('\n\n--- ')[0] ?? '').trim();
}

/** Verbs a person uses to tell an agent to act. */
const ACT_VERB = '(?:approve|go|proceed|run|re-?run|retry|build|ship|merge|dispatch|start|restart|fix|do|write|file|update|change|add|put|make|send|decide|finish|unblock|continue|kick\\s+off|resume)';

/** The message (or a clause of it) opens on the instruction: "approve, fix and run", "write it". */
const OPENS_ON_ACT = new RegExp(`^(?:(?:ok(?:ay)?|yes|yep|yeah|sure|please|great|good|perfect|right|and|then|now|so|alright)[,.!\\s]+)*${ACT_VERB}\\b`, 'i');

/** A bare go-ahead: "yes", "do it", "go ahead", "ship it". */
const AFFIRM = /^(?:yes|yep|yeah|ok(?:ay)?|sure|lgtm|do it|go(?: ahead)?|ship it|sounds good|please do)[\s.!]*$/i;

/** Asking about acting is not asking to act. */
const NOT_ACT = /\b(?:don'?t|do not|never|not yet|hold off|wait for|should (?:i|we)|how (?:do|can|would|should)|what (?:would|if|do)|why)\b/i;

const CLAUSE = /\n|[:;]\s*|(?:^|\s)(?:\d+[).]|[-*•])\s+/;

/**
 * Did the person tell the agent to do something, rather than ask about it?
 * "approve, fix and run" and "write it" do; "what do we need to unblock and
 * finish?" and "should I approve it?" do not.
 * @param request - The person's message, as the model received it.
 */
export function asksForAction(request: string | null | undefined): boolean {
  const text = personWords(request);
  if (!text || NOT_ACT.test(text) || /\?\s*$/.test(text)) {
    return false;
  }
  return AFFIRM.test(text) || OPENS_ON_ACT.test(text) || text.split(CLAUSE).some(c => OPENS_ON_ACT.test(c.trim()));
}

/** A sentence that announces the next move: "Let me write the plan now.", "I'll put the card up now.", "Next I'll dispatch it." */
const ANNOUNCES = /^(?:(?:ok(?:ay)?|right|so|now|next|then|first)[,\s]+)?(?:let me\s|i(?:['’]ll| will| am going to|['’]m going to| am about to|['’]m about to)\s|(?:putting|writing|filing|drafting|adding|starting|dispatching|approving|updating|running|doing)\s(?:[^.!?]*\s)?now\b)/i;

/** Announcements that are not a promise of work this turn: "Let me know…", "I'll be here…". */
const NOT_A_PROMISE = /^(?:let me know|i(?:['’]ll| will) (?:be |wait|hold|stand by|leave|keep|check back|come (?:straight )?back|follow up|report back|need|let you know))/i;

/**
 * The sentence a turn ended on when it announces an action instead of
 * taking it — null when the answer ends any other way.
 * @param text - The turn's finished text.
 */
export function announcedAction(text: string): string | null {
  const lines = (text ?? '').replace(/<[^>]*>/g, ' ').split('\n').map(l => l.trim()).filter(Boolean);
  const last = lines.at(-1);
  if (!last) {
    return null;
  }
  const sentence = (last.split(/(?<=[.!?…])\s+/).filter(Boolean).at(-1) ?? '').replace(/^[*_#>\s-]+|[*_\s]+$/g, '');
  if (sentence.length === 0 || sentence.length > 200 || sentence.endsWith('?')) {
    return null;
  }
  return ANNOUNCES.test(sentence) && !NOT_A_PROMISE.test(sentence) ? sentence : null;
}

export type Decision = 'approve' | 'reject' | 'defer';

const SAID: Record<Decision, RegExp> = {
  approve: /\b(?:approve[ds]?|approving|go ahead|go for it|yes|yep|yeah|ok(?:ay)?|do it|run it|build it|ship it|start it|dispatch it|lgtm|confirm(?:ed)?|accept(?:ed)?|sounds good|green ?light|proceed)\b/i,
  reject: /\b(?:reject(?:ed)?|declined?|no|nope|kill it|drop it|cancel(?:led)?|turn (?:it )?down|leave it stopped)\b/i,
  defer: /\b(?:defer(?:red)?|snooze|later|next week|not now|park it)\b/i,
};

/** "don't approve it", "do not run" — the verb said, and refused. */
const NEGATED = /\b(?:don'?t|do not|never|not yet|hold off(?: on)?)\s+(?:\w+\s+){0,2}?(?:approve|run|build|ship|dispatch|start|go|reject|defer|decide)\b/i;

/**
 * Did the person's own words say to take this decision? The gate on every
 * decision an agent takes for a person: their message, not the model's
 * reading of the thread.
 * @param message - The person's words (their message this turn).
 * @param decision - `approve`, `reject`, `defer`, or an ask's option id.
 * @param option - The option, when `decision` is one: its label and whether it is the recommended one.
 * @param option.label - The option's label.
 * @param option.recommended - Whether it is the ask's recommended answer.
 */
export function personSaid(message: string | null | undefined, decision: string, option?: { label?: string; recommended?: boolean }): boolean {
  const words = personWords(message);
  if (!words || NEGATED.test(words) || /^(?:should|can|could|would|do|does|is|are)\b[^.!]*\?\s*$/i.test(words)) {
    return false;
  }
  if (decision in SAID) {
    return SAID[decision as Decision].test(words);
  }
  const lower = words.toLowerCase();
  const id = decision.replace(/[_-]+/g, ' ').toLowerCase();
  if (id.length > 2 && lower.includes(id)) {
    return true;
  }
  const label = (option?.label ?? '').toLowerCase().trim();
  if (label && lower.includes(label)) {
    return true;
  }
  return option?.recommended === true && SAID.approve.test(words);
}

/**
 * Did the person say it, in this turn — or, when this turn's message is a
 * bare follow-on ("write it", "do it") to an instruction the last turn did
 * not carry out, in the message before? One message back, never further.
 * @param messages - The person's messages, newest first.
 * @param decision - See {@link personSaid}.
 * @param option - See {@link personSaid}.
 * @param option.label
 * @param option.recommended
 */
export function personSaidRecently(messages: ReadonlyArray<string | null | undefined>, decision: string, option?: { label?: string; recommended?: boolean }): boolean {
  const [latest, previous] = messages;
  if (personSaid(latest, decision, option)) {
    return true;
  }
  const said = personWords(latest);
  if (!previous || !asksForAction(latest) || NEGATED.test(said) || (SAID.reject.test(said) && decision !== 'reject')) {
    return false;
  }
  return personSaid(previous, decision, option);
}

/**
 * The first decision the person's words name, if any.
 * @param message
 */
export function decisionNamed(message: string | null | undefined): Decision | null {
  const words = personWords(message);
  if (!words || NEGATED.test(words)) {
    return null;
  }
  for (const d of ['approve', 'reject', 'defer'] as const) {
    if (SAID[d].test(words)) {
      return d;
    }
  }
  return null;
}

/** Something waiting on the person: a pending proposal (a card) or an open ask. */
export type OpenDecision = {
  kind: 'proposal' | 'ask';
  id: number;
  title: string;
  /** A proposal's action. */
  actionId?: string;
  /** An ask's answers. */
  options?: Array<{ id: string; label: string; recommended?: boolean }>;
};

/**
 * The decisions, as the model reads them — one line each, with the call
 * that decides it.
 * @param decisions - What is waiting.
 */
export function describeOpenDecisions(decisions: readonly OpenDecision[]): string {
  return decisions.map(d => d.kind === 'proposal'
    ? `- proposal #${d.id} (${d.actionId ?? 'an action'}): ${d.title} — decide_proposal id ${d.id}`
    : `- ask #${d.id}: ${d.title}${d.options && d.options.length > 0 ? ` — answers: ${d.options.map(o => `${o.id} ("${o.label}")`).join(', ')}` : ' — answers: approve, reject'} — decide_ask id ${d.id}`).join('\n');
}

/**
 * Cards still waiting in this conversation's replay (`withLiveCardState`
 * stamped each card's proposal as it stands now).
 * @param history - The stored turns.
 */
export function pendingCards(history: ReadonlyArray<{ role: string; runs?: unknown }>): OpenDecision[] {
  const out: OpenDecision[] = [];
  for (const t of history) {
    if (t.role !== 'assistant' || !Array.isArray(t.runs)) {
      continue;
    }
    for (const r of t.runs as Array<{ type?: string; runId?: number; status?: string; state?: string; label?: string; actionId?: string }>) {
      if (r?.type === 'card' && typeof r.runId === 'number' && (r.status ?? 'pending') === 'pending' && r.state !== 'unfiled') {
        out.push({ kind: 'proposal', id: r.runId, title: String(r.label ?? `proposal #${r.runId}`), actionId: r.actionId });
      }
    }
  }
  return out;
}

/**
 * Everything waiting on a person about the record on their page: its open
 * asks and the pending proposals whose input names it. Never throws.
 * @param orgId - The workspace.
 * @param recordId - The page's record.
 */
export async function openDecisionsOn(orgId: string, recordId: number): Promise<OpenDecision[]> {
  try {
    const { and, eq, or, sql } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { actionRunSchema, askSchema } = await import('@/models/Schema');
    const id = String(recordId);
    const [asks, runs] = await Promise.all([
      db.select({ id: askSchema.id, title: askSchema.title, options: askSchema.options })
        .from(askSchema)
        .where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open'), sql`${askSchema.objectRefs} @> ${JSON.stringify([{ id }])}::jsonb`))
        .limit(10),
      db.select({ id: actionRunSchema.id, actionId: actionRunSchema.actionId, input: actionRunSchema.input, proposal: actionRunSchema.proposal })
        .from(actionRunSchema)
        .where(and(
          eq(actionRunSchema.orgId, orgId),
          eq(actionRunSchema.status, 'pending'),
          or(sql`${actionRunSchema.input}->>'requestId' = ${id}`, sql`${actionRunSchema.input}->>'objectId' = ${id}`, sql`${actionRunSchema.input}->>'id' = ${id}`),
        ))
        .limit(10),
    ]);
    return [
      ...runs.map(r => ({ kind: 'proposal' as const, id: r.id, actionId: r.actionId, title: proposalTitle(r.actionId, r.input, r.proposal) })),
      ...asks.map(a => ({ kind: 'ask' as const, id: a.id, title: a.title, options: (a.options ?? []).map(o => ({ id: String(o.id), label: String(o.label), ...(o.recommended ? { recommended: true } : {}) })) })),
    ];
  } catch (err) {
    console.warn('open decisions read failed', { orgId, recordId, message: (err as Error).message });
    return [];
  }
}

function proposalTitle(actionId: string, input: Record<string, unknown> | null, proposal: unknown): string {
  const p = (proposal ?? {}) as { label?: unknown; rationale?: unknown };
  const said = typeof p.label === 'string' ? p.label : typeof input?.reason === 'string' ? input.reason : typeof p.rationale === 'string' ? p.rationale : '';
  return `${actionId}${said ? `: ${said.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`;
}

/**
 * One list, each decision once: the page record's, then the conversation's cards.
 * @param lists - Decisions from each source.
 */
export function mergeDecisions(...lists: ReadonlyArray<readonly OpenDecision[]>): OpenDecision[] {
  const seen = new Set<string>();
  const out: OpenDecision[] = [];
  for (const d of lists.flat()) {
    const key = `${d.kind}:${d.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(d);
    }
  }
  return out;
}

/** The tools that decide something for a person. */
export const DECIDE_TOOLS = ['decide_proposal', 'decide_ask'] as const;

/** A decision the tool took (not a refusal). */
const DECIDED = /^(?:Approved|Rejected|Deferred|Decided)\b/;

/**
 * Did the turn decide something for the person?
 * @param toolCalls - The turn's tool calls.
 */
export function decidedInTurn(toolCalls: ReadonlyArray<{ tool: string; output?: string }>): boolean {
  return toolCalls.some(c => (DECIDE_TOOLS as readonly string[]).includes(c.tool) && DECIDED.test((c.output ?? '').trim()));
}

export type OwedDecisionCall = { tool: string; input: Record<string, unknown>; output: string };
export type OwedDecisionResult = { calls: OwedDecisionCall[]; lines: string[] };

/**
 * Carry out the decision the person's words took, once: the decide tools
 * (and update_object, for a change they asked to land first) bound, a call
 * required on the first step, at most three steps. Every call is the
 * registry's own tool, so it rides that tool's gates — the person's words
 * ({@link personSaid}), the review queue, the tool-call row.
 * @param opts - The turn.
 * @param opts.request - The person's message this turn.
 * @param opts.history - Earlier messages, oldest first.
 * @param opts.answer - What the turn answered.
 * @param opts.systemPrompt - The agent's own prompt.
 * @param opts.decisions - What is waiting on the person.
 * @param opts.tools - The tools the pass may call (decide_proposal, decide_ask, update_object), as the registry built them.
 * @param opts.model - A chat model for the pass.
 */
export async function decideOwed(opts: {
  request: string;
  history: ReadonlyArray<OwedWriteTurn>;
  answer: string;
  systemPrompt?: string;
  decisions: readonly OpenDecision[];
  tools: readonly StructuredToolInterface[];
  model: OwedWriteModel;
}): Promise<OwedDecisionResult> {
  const result: OwedDecisionResult = { calls: [], lines: [] };
  if (!opts.model.bindTools || opts.tools.length === 0 || opts.decisions.length === 0) {
    return result;
  }
  const { HumanMessage, SystemMessage, ToolMessage } = await import('@langchain/core/messages');
  const byName = new Map(opts.tools.map(t => [t.name, t]));
  const words = personWords(opts.request);
  const convo = opts.history.slice(-6).map(t => `${t.role === 'user' ? 'Person' : 'You'}: ${t.content.slice(0, 3_000)}`).join('\n\n');
  const messages: BaseMessage[] = [
    new SystemMessage(`${opts.systemPrompt ?? ''}\n\nDECISION PASS: the person told you what to do — "${words.slice(0, 300)}" — and this turn ended without doing it. The decisions waiting on them are listed below. Carry out what they said, now: decide each decision their words cover, with decide_proposal for a proposal and decide_ask for an ask, their words as the note. If their words also ask for a change to land first ("fix", "add the line"), make it with update_object BEFORE deciding, because approving can freeze what it carries. Decide nothing they did not say. When two decisions would start the same work, decide the one that carries it (the proposal) and leave the other: one start, not two. Make the calls; no prose.`),
    new HumanMessage(`${convo ? `The conversation so far:\n\n${convo}\n\n` : ''}The person, this turn: ${words.slice(0, 2_000)}\n\nYour answer this turn:\n${opts.answer.slice(0, 3_000) || '(nothing)'}\n\nWaiting on the person:\n${describeOpenDecisions(opts.decisions)}`),
  ];
  // A call is required on the first step; after it the pass may stop. Three
  // steps at most — a change, a decision, and one retry of a refusal.
  for (let step = 0; step < 3; step++) {
    const model = opts.model.bindTools([...opts.tools], step === 0 ? { tool_choice: 'any' } : undefined);
    const res = await model.invoke(messages);
    const calls = (res.tool_calls ?? []).filter(c => byName.has(c.name));
    if (calls.length === 0) {
      break;
    }
    messages.push(res);
    for (const [i, call] of calls.entries()) {
      const id = call.id ?? `owed-decision-${step}-${i}`;
      const output = await byName.get(call.name)!.invoke({ type: 'tool_call', id, name: call.name, args: call.args } as never).then(
        r => (typeof r === 'string' ? r : String((r as { content?: unknown }).content ?? '')),
        (err: Error) => `Refused: ${err.message}`,
      );
      result.calls.push({ tool: call.name, input: call.args, output });
      if ((DECIDE_TOOLS as readonly string[]).includes(call.name) && DECIDED.test(output.trim())) {
        result.lines.push(output.trim().split(/(?<=\.)\s/)[0]!);
      }
      messages.push(new ToolMessage({ content: output, tool_call_id: id }));
    }
    if (decidedInTurn(result.calls) && !calls.some(c => !(DECIDE_TOOLS as readonly string[]).includes(c.name))) {
      break;
    }
  }
  return result;
}

/**
 * The person's words a decision tool is gated on: this turn's message
 * (`ctx.turnMessage`, else the conversation's latest), then the one before.
 * Empty when the turn has no conversation. Never throws.
 * @param ctx - The turn.
 * @param ctx.orgId - The workspace.
 * @param ctx.conversationId - The conversation.
 * @param ctx.turnMessage - This turn's message, as typed.
 */
export async function personMessages(ctx: { orgId: string; conversationId?: number | null; turnMessage?: string }): Promise<string[]> {
  let stored: string[] = [];
  if (ctx.conversationId) {
    try {
      const { and, desc, eq } = await import('drizzle-orm');
      const { db } = await import('@/libs/DB');
      const { conversationMessageSchema, conversationSchema } = await import('@/models/Schema');
      const rows = await db
        .select({ content: conversationMessageSchema.content })
        .from(conversationMessageSchema)
        .innerJoin(conversationSchema, eq(conversationSchema.id, conversationMessageSchema.conversationId))
        .where(and(eq(conversationSchema.orgId, ctx.orgId), eq(conversationMessageSchema.conversationId, ctx.conversationId), eq(conversationMessageSchema.role, 'user')))
        .orderBy(desc(conversationMessageSchema.id))
        .limit(2);
      stored = rows.map(r => String(r.content ?? ''));
    } catch {
      stored = [];
    }
  }
  if (ctx.turnMessage === undefined) {
    return stored;
  }
  // The route stores the message before the agent runs, so the newest stored
  // row is this turn's; the one before it is the previous message.
  const previous = stored[0] !== undefined && personWords(stored[0]) === personWords(ctx.turnMessage) ? stored[1] : stored[0];
  return [ctx.turnMessage, ...(previous !== undefined ? [previous] : [])];
}
