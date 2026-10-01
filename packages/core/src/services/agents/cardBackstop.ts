import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
/**
 * THE CARD PASS — the cards a finished answer owes, in seconds.
 *
 * When an agent's harness sets `recommendActionBackstop` and a turn put up
 * fewer than three cards, this pass reads the answer the person already has
 * and puts up the cards it names. It used to be ONE call that wrote three to
 * five cards with their ready-to-send bodies, one after another, and a card
 * reached the screen only when the model had finished writing it: up to ~40s
 * after the answer for the last one (Chris, 2026-09-25: "why does it take 40
 * seconds to render the card"). The time was all output — a card body is a
 * few hundred tokens and the calls wrote them in sequence.
 *
 * Two steps now:
 *
 *   1. **List.** One fast, small call (the `classifier` role) names the
 *      decisions the answer names — a label, one line of why, the action that
 *      carries it — at most five, minus those already carded. Tiny output.
 *   2. **Write, in parallel.** One call per card (the `extractor` role), each
 *      told only which card it writes and handed the agent's card rules, the
 *      one action it uses and the answer. Each card goes up the moment its own
 *      call returns, so the first lands in the time of one card, not five, and
 *      the last in the time of the slowest.
 *
 * What it keeps, structurally: a card already on screen is never written
 * twice; the answer is never rewritten (a card that cannot go up is added
 * under it as one line, never edited into it); every model call is charged;
 * every card attempt is a tool_call row on the conversation.
 *
 * NO DEAD CARDS (Chris, 2026-09-28, conversation 351): a card whose action is
 * refused used to go up anyway with its action stripped — "Nothing to run:
 * this is a note · Waiting on you", nothing to press. A card now either
 * carries an action its own checks accept or it is not a card: it becomes one
 * line under the answer saying what it was and why it is not a card. And a
 * card that recommends building something no request was filed for becomes
 * the filing (`objects.propose_candidate`, a request), so the filing gates run
 * — the proposal-ready bar, the check against what already ships — instead of
 * a build card that can only fail.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { AgentEvent, RuntimeContext } from './types';
import type { Action } from '@/libs/actions/types';
import type { ModelRole } from '@/libs/llm';
import { labelWithResolvedRefs } from '@/libs/actions/cardLabel';
import { repairActionInput } from '@/libs/actions/repairInput';
import { appBaseUrl } from '@/libs/links';

/** At most this many cards per pass — the agents' own rule is "top 3–5 by leverage". */
export const MAX_CARDS = 5;

/** The card rules a writer gets whole below this size; above it, the paragraphs about cards and voice. */
const WHOLE_PROMPT_CHARS = 16_000;

/** Cap on the extracted card rules. */
const RULES_CAP_CHARS = 8_000;

/** How long one call may take before its card is given up on. */
const LIST_TIMEOUT_MS = 15_000;
const CARD_TIMEOUT_MS = 30_000;

/** The build action, and the filing a build of an unfiled idea becomes. */
export const BUILD_ACTION = 'factory.dispatch_task';
export const FILE_ACTION = 'objects.propose_candidate';
/** A question put to a person — never the answer to their instruction. */
export const ASK_ACTION = 'ask.file';

/** One decision the answer names, as the list step returns it. */
export type OwedTouch = { label: string; why: string; actionId: string };

/** What a tool handed back: `{ok:false, error}` is a refusal, anything else counts as done. */
type ToolOutcome = { ok: boolean; error?: string; output: string };

/** Everything the pass reaches outside itself — real in production, scripted in tests. */
export type CardBackstopDeps = {
  /** The list step's model (`classifier`). */
  listModel: () => Promise<BaseChatModel>;
  /** The card writers' model (`extractor`); built once per card. */
  cardModel: () => Promise<BaseChatModel>;
  /** `recommend_action`, describing only these actions. */
  tool: (actionIds: readonly string[]) => StructuredToolInterface;
  /** `id — first sentence of its description`, for every registered action. */
  actionCatalog: () => string;
  /** Is there an action by this id? */
  hasAction: (id: string) => boolean;
  /** The action's own checks on this input — schema, then its `precheck`. A reason to refuse, or nothing. */
  precheck: (actionId: string, input: Record<string, unknown>) => Promise<string | undefined>;
  /**
   * The repairs the action's schema admits with one right answer — a missing
   * title from the label, a relative URL made absolute (`libs/actions/repairInput.ts`).
   * Absent, nothing is repaired.
   */
  repair?: (actionId: string, input: Record<string, unknown>, label: string) => { input: Record<string, unknown>; repaired: string[] };
  /** Is there a request record with this id in the workspace? */
  requestExists: (id: number) => Promise<boolean>;
  /**
   * The records this conversation's own actions filed, newest first
   * (`action_run.proposal.origin.conversationId`). A build card that names no
   * request is for the one the thread already filed, not a new filing
   * (conversation 394, 2026-09-30: "File as a feature request: Approve
   * dispatch to engineer" went up a minute after request #265 was filed there).
   */
  threadRecordIds?: () => Promise<number[]>;
  /**
   * The agent's typed filing tool for a type (`file_<slug>`, `tools/fileRecord.ts`),
   * when it has one: its schema is the type's own, required fields marked, so a
   * filing card is written through it rather than as free-form fields.
   */
  filingTool?: (objectType: string) => TypedFiling | undefined;
  /** Charge one model call's usage. */
  charge: (role: ModelRole, response: unknown) => Promise<void>;
  /** Write one tool_call row for a card attempt. */
  record: (row: { input: Record<string, unknown>; output?: string; error?: string; durationMs: number }) => Promise<void>;
  /** The turn's event stream. */
  emit: (event: AgentEvent) => void;
  /**
   * Has the conversation moved on? The pass runs after the answer, with the
   * composer free, so the person may already have sent the next message; a
   * card for a turn they have moved past is obsolete and is never put up.
   * Absent, nothing supersedes.
   */
  superseded?: () => boolean;
  /** Langfuse callbacks for the pass's model calls. */
  callbacks?: BaseCallbackHandler[];
  /** Log line sink (console.warn in production). */
  log?: (message: string, detail: Record<string, unknown>) => void;
};

/** A type's filing tool as the card pass uses it: its schema, how its arguments become the input, the type's word. */
export type TypedFiling = { tool: StructuredToolInterface; input: (args: Record<string, unknown>) => Record<string, unknown>; label: string };

export type CardBackstopResult = {
  /** Decisions the list step named (after dedup). */
  listed: number;
  /** Filing cards written through the type's own tool. */
  typed?: number;
  /** Filings that still missed the bar, put up as "Draft needed". */
  drafts?: number;
  /** Cards put up. */
  emitted: number;
  /** Cards whose action was refused (by the tool or the action's own checks). */
  refused: number;
  /** Build cards turned into the filing. */
  mapped: number;
  /** Cards whose input was repaired before it was checked. */
  repaired?: number;
  /**
   * One line each for the decisions that could not be cards. For the run log
   * and the trace, never the reply: a failure the person cannot act on is
   * noise in the transcript (Chris, 2026-09-29).
   */
  notes: string[];
};

/**
 * Words to compare labels by: lower case, letters and digits only.
 * @param s
 */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Is this label the same card as one already up? Equal after normalising, or
 * one contains the other when both are long enough to mean something.
 * @param label - The new card's label.
 * @param already - Labels already on screen.
 */
export function isSameCard(label: string, already: readonly string[]): boolean {
  const a = norm(label);
  if (!a) {
    return false;
  }
  return already.some((b0) => {
    const b = norm(b0);
    return !!b && (a === b || (Math.min(a.length, b.length) >= 12 && (a.includes(b) || b.includes(a))));
  });
}

/**
 * The part of the agent's system prompt a card writer needs: the whole of it
 * when it is small (the input side is cheap; it was never the slow part), and
 * otherwise the opening (who the agent is, how it speaks) plus every
 * paragraph about cards, decisions, drafts and voice, in order, capped.
 * @param prompt - The agent's system prompt.
 */
export function cardRulesOf(prompt: string): string {
  const text = prompt.trim();
  if (text.length <= WHOLE_PROMPT_CHARS) {
    return text;
  }
  const paragraphs = text.split(/\n\s*\n/);
  const about = /recommend_action|\bcards?\b|decid|decision|approv|draft|subject|\bbody\b|voice|tone|phone|ready-to-send|sign[- ]off|never say|do not say/i;
  const kept: string[] = [];
  let size = 0;
  for (const [i, p] of paragraphs.entries()) {
    if (i < 2 || about.test(p)) {
      if (size + p.length > RULES_CAP_CHARS) {
        break;
      }
      kept.push(p);
      size += p.length + 2;
    }
  }
  return kept.join('\n\n');
}

/**
 * The backstop model's call, made to fit the tool's schema: every field the tool requires, present.
 * @param args - The call's arguments as the model wrote them.
 */
export function shapeRecommendCall(args: Record<string, unknown>): Record<string, unknown> {
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const input = args.action_input && typeof args.action_input === 'object' && !Array.isArray(args.action_input) ? args.action_input as Record<string, unknown> : {};
  return {
    ...args,
    action_id: str(args.action_id) ?? '',
    action_input: input,
    label: (str(args.label) ?? str(args.title) ?? str(input.title) ?? 'Recommendation').slice(0, 120),
    ...(str(args.rationale) ? { rationale: str(args.rationale) } : {}),
  };
}

function positiveInt(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * "Dispatch: link expiry" → "link expiry": the thing, without the verb the card put in front of it.
 * @param label
 */
function thingOf(label: string): string {
  return label.replace(/^\s*(?:approve (?:the )?build|start (?:the )?build|build|dispatch|ship|implement)\s*[:—–-]\s*/i, '').trim() || label.trim();
}

/**
 * A BUILD OF SOMETHING NOBODY FILED IS A FILING. A card that recommends
 * `factory.dispatch_task` names the request it builds (`requestId`) or the
 * task (`taskId`); one that names neither — or a request that does not exist
 * — is an idea, and the one move for an idea is to file it as a request, where
 * the filing gates judge it. Conversation 351 (2026-09-28) is the specimen:
 * "Dispatch: StampSend link expiry & auto-disable", no request behind it, the
 * action refused, a card with nothing to press.
 * @param shaped - The shaped call.
 * @param requestExists - Is there a request by this id?
 * @param threadRecordIds
 */
export async function buildOrFiling(shaped: Record<string, unknown>, requestExists: (id: number) => Promise<boolean>, threadRecordIds?: () => Promise<number[]>): Promise<{ call: Record<string, unknown>; mapped: boolean }> {
  if (shaped.action_id !== BUILD_ACTION) {
    return { call: shaped, mapped: false };
  }
  const input = shaped.action_input as Record<string, unknown>;
  if (positiveInt(input.taskId) !== null) {
    return { call: shaped, mapped: false };
  }
  const requestId = positiveInt(input.requestId);
  if (requestId !== null && await requestExists(requestId).catch(() => false)) {
    return { call: shaped, mapped: false };
  }
  // The request this thread already filed, when there is one.
  for (const id of await threadRecordIds?.().catch(() => []) ?? []) {
    if (await requestExists(id).catch(() => false)) {
      return { call: { ...shaped, action_input: { ...input, requestId: id } }, mapped: false };
    }
  }
  const contract = input.contract && typeof input.contract === 'object' ? input.contract as Record<string, unknown> : {};
  // A filing names a record that does not exist yet: every record number the
  // model typed into the build it meant is dropped (s1: "(request 207)").
  const title = labelWithResolvedRefs(thingOf(typeof contract.title === 'string' && contract.title.trim() ? contract.title : String(shaped.label ?? '')), {}).slice(0, 200);
  const summary = [contract.objective, shaped.rationale].find(v => typeof v === 'string' && v.trim()) as string | undefined;
  return {
    mapped: true,
    call: {
      ...shaped,
      action_id: FILE_ACTION,
      label: `File as a feature request: ${title}`.slice(0, 120),
      action_input: {
        objectType: 'request',
        title,
        fields: { title, ...(summary ? { summary } : {}) },
        dedupOn: ['title'],
        ...(summary ? { summary: summary.slice(0, 5000) } : {}),
      },
    },
  };
}

/**
 * The list step's JSON, read leniently: the first array in the reply, each
 * entry with a label; anything else is no decisions.
 * @param text - The model's reply.
 */
export function parseTouches(text: string): OwedTouch[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) {
    return [];
  }
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.flatMap((e) => {
      const o = e && typeof e === 'object' ? e as Record<string, unknown> : {};
      const label = typeof o.label === 'string' ? o.label.trim() : '';
      if (!label) {
        return [];
      }
      return [{ label: label.slice(0, 120), why: typeof o.why === 'string' ? o.why.trim().slice(0, 300) : '', actionId: typeof o.action === 'string' ? o.action.trim() : typeof o.actionId === 'string' ? o.actionId.trim() : '' }];
    });
  } catch {
    return [];
  }
}

function textOf(response: unknown): string {
  const c = (response as { content?: unknown } | null)?.content;
  if (typeof c === 'string') {
    return c;
  }
  if (Array.isArray(c)) {
    return c.map(b => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : '')).join('');
  }
  return '';
}

function readToolResult(raw: unknown): ToolOutcome {
  const text = typeof raw === 'string' ? raw : typeof (raw as { content?: unknown })?.content === 'string' ? (raw as { content: string }).content : '';
  try {
    const parsed = JSON.parse(text) as { ok?: boolean; error?: string };
    return parsed && parsed.ok === false ? { ok: false, error: parsed.error, output: text } : { ok: true, output: text };
  } catch {
    return { ok: true, output: text };
  }
}

/**
 * One tool call that cannot end the pass: a thrown schema error is a refusal with its message.
 * @param tool - `recommend_action`.
 * @param args - The shaped call.
 */
async function invokeRecommend(tool: StructuredToolInterface, args: Record<string, unknown>): Promise<ToolOutcome> {
  try {
    return readToolResult(await tool.invoke(args as never));
  } catch (err) {
    const error = (err as Error).message.replace(/\s+/g, ' ').slice(0, 300);
    return { ok: false, error, output: '' };
  }
}

/**
 * The live line: what the pass is doing, with counts.
 * @param total
 * @param ready
 * @param noted
 */
function progress(total: number, ready: number, noted: number): string {
  const cards = `${total} decision card${total === 1 ? '' : 's'}`;
  const tail = noted > 0 ? ` · ${noted} set aside` : '';
  return ready + noted >= total
    ? `${ready} of ${cards} ready${tail}`
    : `Writing ${cards} · ${ready} of ${total} ready${tail}`;
}

/**
 * The one line under the answer for a decision that could not be a card.
 * @param label - The card's label.
 * @param reason - Why it is not a card.
 */
export function noteLine(label: string, reason: string): string {
  const why = reason.replace(/\s+/g, ' ').replace(/^Not proposed:\s*/i, '').trim().slice(0, 240);
  return `- **${label.replace(/[*_`[\]]/g, '')}** — not a card: ${why}${/[.!?]$/.test(why) ? '' : '.'}`;
}

/**
 * The prompt a "Draft needed" card sends when pressed: the agent drafts the
 * whole record in the conversation, the fields the bar named first, and files it.
 * @param kind - The record's type, in words ("request").
 * @param title - What it is.
 * @param missing - What the bar said is missing.
 */
export function draftPrompt(kind: string, title: string, missing: string): string {
  return `Draft the full ${kind} "${title}" from this conversation — ${missing.replace(/[.\s]+$/, '')}. Write every field it needs, in my words where I gave them, then file it.`;
}

/**
 * A FILING CARD IS WRITTEN THROUGH ITS TYPE'S TOOL (Chris, 2026-09-28: "File
 * in-app notifications as its own request in core — not a card: this request
 * fails the proposal-ready bar: story… acceptance…"). The card writer had
 * filled objects.propose_candidate's free-form `fields` and missed a bar it
 * cannot see. One call with `file_<slug>` bound and CHOSEN makes the model
 * write the type's required fields — story, outcome, acceptance — from the
 * conversation; its arguments become the card's input. The tool is never
 * invoked here: the card still goes up as a recommendation, on the trust bar.
 * @param opts - The card, the typed tool and the model.
 * @param opts.label - The card's label.
 * @param opts.why - Why the card.
 * @param opts.answer - The answer.
 * @param opts.conversation - The conversation so far, as text.
 * @param opts.rules - The agent's card rules.
 * @param opts.filing - The typed tool.
 * @param opts.model - The card writer's model.
 * @param opts.callbacks - Langfuse callbacks.
 * @returns The typed input (null when no call came back) and the response, for charging.
 */
async function typedFilingInput(opts: { label: string; why: string; answer: string; conversation?: string; rules: string; filing: TypedFiling; model: BaseChatModel; callbacks?: BaseCallbackHandler[] }): Promise<{ input: Record<string, unknown> | null; response: unknown }> {
  const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
  if (!opts.model.bindTools) {
    return { input: null, response: null };
  }
  const bound = opts.model.bindTools([opts.filing.tool], { tool_choice: opts.filing.tool.name } as never);
  const sys = `${opts.rules}\n\nFILING CARD: the answer below was already delivered. Write the ${opts.filing.label} it recommends filing — "${opts.label}" — by calling ${opts.filing.tool.name} ONCE. Its arguments ARE the ${opts.filing.label}'s fields: fill every required one from the conversation and the answer, in the person's words where they gave them and yours where the thread settled it. Never a placeholder. Output the tool call only.`;
  const human = `${opts.conversation ? `THE CONVERSATION:\n${opts.conversation}\n\n` : ''}CARD FOR: ${opts.label}\nWhy: ${opts.why || 'named in the answer'}\n\nTHE ANSWER:\n${opts.answer}`;
  const response = await bound.invoke([new SystemMessage(sys), new HumanMessage(human)], { signal: AbortSignal.timeout(CARD_TIMEOUT_MS), callbacks: opts.callbacks } as never);
  const call = ((response as { tool_calls?: Array<{ name: string; args: Record<string, unknown> }> }).tool_calls ?? []).find(c => c.name === opts.filing.tool.name);
  return { input: call ? opts.filing.input(call.args ?? {}) : null, response };
}

/**
 * Run the pass over a finished answer.
 * @param input - What the pass reads.
 * @param input.answer - The answer the person already has.
 * @param input.already - Labels of the cards already on screen.
 * @param input.agentPrompt - The agent's system prompt (its card rules and voice).
 * @param input.conversation
 * @param input.instruction
 * @param input.instructed
 * @param deps - Everything outside.
 */
export async function runCardBackstop(input: { answer: string; already: readonly string[]; agentPrompt: string; conversation?: string; instruction?: string; instructed?: boolean }, deps: CardBackstopDeps): Promise<CardBackstopResult> {
  const log = deps.log ?? ((m: string, d: Record<string, unknown>) => console.warn(m, d));
  const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
  const result: CardBackstopResult = { listed: 0, emitted: 0, refused: 0, mapped: 0, typed: 0, drafts: 0, notes: [] };
  const rules = cardRulesOf(input.agentPrompt);
  const onScreen = [...input.already];

  // 1. LIST — small and fast: labels and a line of why, never a body.
  deps.emit({ type: 'status', label: 'Finding the decisions in the answer' });
  const lister = await deps.listModel();
  const listSys = `You read an answer an agent already gave a person and list the decisions it NAMES that a registered action can carry — the owed, actionable next moves (approve this build, file this request, send this reply). Top ${MAX_CARDS} at most, by leverage. Only what the answer itself names; never invent one. Skip anything already carded. If there are none, return [].

Reply with JSON only, no prose: [{"label": "<button label, under 80 chars, starts with the verb>", "why": "<one line: why now>", "action": "<one action id from the list>"}]

Registered actions:
${deps.actionCatalog()}${rules ? `\n\nThe agent's own rules, for what counts as a card:\n${rules.slice(0, 4_000)}` : ''}`;
  const already = onScreen.length > 0 ? `Already carded (do NOT list these): ${onScreen.map(l => `"${l}"`).join(', ')}\n\n` : '';
  const listed = await lister.invoke([new SystemMessage(listSys), new HumanMessage(`LIST THE DECISIONS\n\n${already}THE ANSWER:\n${input.answer}`)], { signal: AbortSignal.timeout(LIST_TIMEOUT_MS), callbacks: deps.callbacks } as never);
  await deps.charge('classifier', listed);
  const touches: OwedTouch[] = [];
  for (const t of parseTouches(textOf(listed))) {
    if (touches.length >= MAX_CARDS) {
      break;
    }
    if (isSameCard(t.label, [...onScreen, ...touches.map(x => x.label)])) {
      continue;
    }
    // A QUESTION BACK IS NOT A CARD WHEN THE PERSON JUST SAID WHAT TO DO.
    // Conversation 378 (2026-09-29): "write it", a turn that did nothing, and
    // a card asking the person to approve asking them for the context they
    // had just given ("File the question on #201"). Chris: "WTF is it asking
    // me to approve? … I JUST ASKED VOCION TO DO EXACTLY THAT". An ask back
    // to the person who instructed the act is the act left undone. Whether
    // they instructed it is the turn's intent read (`turnJudge.readIntent`).
    if (t.actionId === ASK_ACTION && input.instructed === true) {
      result.notes.push(noteLine(t.label, 'the person told you what to do this turn; a question back to them is not a card'));
      log('card backstop: a question back to the person who gave the instruction was dropped', { label: t.label });
      continue;
    }
    touches.push(t);
  }
  result.listed = touches.length;
  if (touches.length === 0) {
    return result;
  }

  // 2. WRITE — one call per card, all at once; each goes up when it returns.
  // A card that turns out to be a twin, or whose call fails, leaves the count.
  let total = touches.length;
  deps.emit({ type: 'status', label: progress(total, 0, 0) });
  const settle = (): void => deps.emit({ type: 'status', label: progress(total, result.emitted, result.notes.length) });
  const writeOne = async (touch: OwedTouch): Promise<void> => {
    const actionIds = deps.hasAction(touch.actionId)
      ? (touch.actionId === BUILD_ACTION ? [BUILD_ACTION, FILE_ACTION] : [touch.actionId])
      : [];
    const tool = deps.tool(actionIds);
    const base = await deps.cardModel();
    if (!base.bindTools) {
      throw new Error('model does not support tools');
    }
    const model = base.bindTools([tool], { tool_choice: 'recommend_action' } as never);
    const sys = `${rules}\n\nCARD PASS: the answer below was ALREADY delivered to the person — do not rewrite it. Your ONLY job: call recommend_action ONCE, for exactly this decision: "${touch.label}"${touch.why ? ` (${touch.why})` : ''}. Follow your rules above for what the card carries: a real, ready-to-send payload with every field its action needs, filled from the answer — never a placeholder. ${actionIds.includes(BUILD_ACTION) ? `A build names the request it builds (requestId) or the task (taskId); when the answer names no filed request for it, file it instead with ${FILE_ACTION} (objectType "request"). ` : ''}Output the tool call only — no prose.`;
    const response = await model.invoke([new SystemMessage(sys), new HumanMessage(`CARD FOR: ${touch.label}\nWhy: ${touch.why || 'named in the answer'}\n\nTHE ANSWER:\n${input.answer}`)], { signal: AbortSignal.timeout(CARD_TIMEOUT_MS), callbacks: deps.callbacks } as never);
    await deps.charge('extractor', response);
    const call = ((response as { tool_calls?: Array<{ name: string; args: Record<string, unknown> }> }).tool_calls ?? []).find(c => c.name === 'recommend_action');
    if (!call) {
      result.notes.push(noteLine(touch.label, 'the card pass wrote no card for it'));
      log('card backstop: no card written for a listed decision', { label: touch.label });
      settle();
      return;
    }
    const { call: shaped, mapped } = await buildOrFiling(shapeRecommendCall(call.args ?? {}), deps.requestExists, deps.threadRecordIds);
    if (mapped) {
      result.mapped += 1;
    }
    const label = String(shaped.label);
    if (isSameCard(label, onScreen)) {
      log('card backstop: skipped a card already on screen', { label });
      total -= 1;
      settle();
      return;
    }
    // Claimed now, before anything awaits, so a twin written in parallel stops above.
    onScreen.push(label);
    const release = (): void => {
      onScreen.splice(onScreen.indexOf(label), 1);
    };
    const started = Date.now();
    const actionId = String(shaped.action_id ?? '');
    let actionInput = shaped.action_input as Record<string, unknown>;
    // A filing of a typed record is written through the type's own tool.
    const objectType = typeof actionInput.objectType === 'string' ? actionInput.objectType : '';
    const filing = actionId === FILE_ACTION && objectType ? deps.filingTool?.(objectType) : undefined;
    if (filing) {
      const typed = await typedFilingInput({ label: touch.label, why: touch.why, answer: input.answer, conversation: input.conversation, rules, filing, model: await deps.cardModel(), callbacks: deps.callbacks })
        .catch((err: Error) => {
          log('card backstop: the typed filing call failed; the card keeps its own fields', { label, message: err.message });
          return { input: null, response: null };
        });
      if (typed.response) {
        await deps.charge('extractor', typed.response);
      }
      if (typed.input) {
        actionInput = typed.input;
        shaped.action_input = actionInput;
        result.typed = (result.typed ?? 0) + 1;
      }
    }
    // A REPAIRABLE INPUT IS REPAIRED FIRST (2026-09-29: "title: expected
    // string, received undefined", "steps.0.url: Invalid URL"): one right
    // answer, in code, before the action's checks read it.
    if (actionId && deps.repair) {
      const fixed = deps.repair(actionId, actionInput, label);
      if (fixed.repaired.length > 0) {
        actionInput = fixed.input;
        shaped.action_input = actionInput;
        result.repaired = (result.repaired ?? 0) + 1;
        log('card backstop: repaired a card input', { label, actionId, repaired: fixed.repaired });
      }
    }
    // A card with nothing to press is not a card, and a card whose action
    // refuses it can only fail when pressed: neither goes up, and the reason
    // is kept on the tool_call row and in the log — not in the reply.
    const refusal = !actionId
      ? 'no action can carry it; it stays in the answer'
      : await deps.precheck(actionId, actionInput).catch((err: Error) => err.message);
    if (refusal && filing) {
      // A FILING THAT MISSES THE BAR IS DRAFTED, NOT DROPPED: one card that
      // says "Draft needed", whose button asks the agent to draft the whole
      // record here. Nothing is filed until that draft passes the bar.
      const title = String(actionInput.title ?? '').trim() || thingOf(label);
      const missing = refusal.replace(/\s+/g, ' ').replace(/^Not proposed:\s*/i, '').trim().slice(0, 400);
      deps.emit({
        type: 'recommended_action',
        recommendation: {
          actionId,
          input: actionInput,
          label,
          ...(typeof shaped.rationale === 'string' ? { rationale: shaped.rationale } : {}),
          draft: { prompt: draftPrompt(filing.label, title, missing), missing },
        },
      });
      await deps.record({ input: shaped, output: `draft needed: ${missing}`.slice(0, 2000), durationMs: Date.now() - started });
      log('card backstop: a filing missed the bar; put up as Draft needed', { label, actionId, reason: missing.slice(0, 300) });
      result.emitted += 1;
      result.drafts = (result.drafts ?? 0) + 1;
      settle();
      return;
    }
    if (refusal) {
      release();
      result.refused += 1;
      result.notes.push(noteLine(touch.label, refusal));
      await deps.record({ input: shaped, error: `not put up: ${refusal}`.slice(0, 2000), durationMs: Date.now() - started });
      log('card backstop: a card was refused and dropped', { label, actionId, reason: refusal.slice(0, 300), mapped });
      settle();
      return;
    }
    if (deps.superseded?.()) {
      release();
      await deps.record({ input: shaped, error: 'not put up: the person sent the next message first', durationMs: Date.now() - started });
      log('card backstop: superseded by the next message', { label, actionId });
      return;
    }
    const outcome = await invokeRecommend(tool, shaped);
    await deps.record({ input: shaped, ...(outcome.ok ? { output: outcome.output } : { error: outcome.error ?? 'refused' }), durationMs: Date.now() - started });
    if (outcome.ok) {
      result.emitted += 1;
    } else {
      release();
      result.refused += 1;
      result.notes.push(noteLine(touch.label, outcome.error ?? 'its action refused it'));
      log('card backstop: a card was refused and dropped', { label, actionId, reason: outcome.error, mapped });
    }
    settle();
  };
  // One card's failure (a timeout, a dropped connection) is that card's
  // alone: the others still go up, and the count stops waiting for it.
  await Promise.all(touches.map(touch => writeOne(touch).catch((err: Error) => {
    log('card backstop: one card call failed', { label: touch.label, message: err?.message });
    total -= 1;
    settle();
  })));
  return result;
}

/**
 * The pass wired to the product: the org's models, the registry, the budget,
 * the tool_call ledger and Langfuse.
 * @param opts - The turn.
 * @param opts.ctx - The turn's runtime context (org, conversation, trace, emit).
 * @param opts.orgId - Tenant.
 * @param opts.agentSlug - The agent whose turn this is.
 * @param opts.userId - Who asked.
 * @param opts.emit - The turn's emit (counts cards as they go up).
 */
export async function realCardBackstopDeps(opts: { ctx: RuntimeContext; orgId: string; agentSlug: string; userId?: string; emit: (event: AgentEvent) => void }): Promise<CardBackstopDeps> {
  const [{ buildChatModelForOrg }, { recommendActionTool }, registry, { chargeModelCall }, { FEATURES }, { persistToolCall }, { createLangfuseCallback }, { filingInputOf, filingSchema }, { tool }] = await Promise.all([
    import('@/libs/llm'),
    import('./tools/recommendAction'),
    import('@/libs/actions/registry'),
    import('@/services/budget/chargeModelCall'),
    import('@/libs/Langfuse/features'),
    import('./toolCallRecord'),
    import('@/libs/Langfuse'),
    import('./tools/fileRecord'),
    import('@langchain/core/tools'),
  ]);
  // Its own trace (`chat.cards:<agent>`), so the pass's latency reads on its
  // own; charged through `chargeModelCall`, never through the trace hook.
  const { handler } = createLangfuseCallback({ feature: FEATURES.CHAT_CARDS, slug: opts.agentSlug, orgId: opts.orgId, userId: opts.userId ?? 'system', metadata: { parentTraceId: opts.ctx.traceId ?? null, conversationId: opts.ctx.conversationId ?? null } });
  const ctx = { ...opts.ctx, orgId: opts.ctx.orgId ?? opts.orgId, agentSlug: opts.ctx.agentSlug ?? opts.agentSlug, emit: opts.emit } as RuntimeContext;
  return {
    listModel: () => buildChatModelForOrg('classifier', opts.orgId, { temperature: 0, streaming: false, maxTokens: 600 }),
    cardModel: () => buildChatModelForOrg('extractor', opts.orgId, { temperature: 0, streaming: false, maxTokens: 2_000 }),
    tool: actionIds => recommendActionTool(ctx, { actionIds }),
    actionCatalog: () => registry.listActions().map(a => `${a.id} — ${a.description.split(/(?<=\.)\s/)[0]!.slice(0, 160)}`).join('\n'),
    hasAction: id => !!id && registry.getAction(id) !== undefined,
    precheck: async (actionId, input) => {
      const action = registry.getAction(actionId);
      if (!action) {
        return `no registered action "${actionId}"`;
      }
      // What the model may not write (`internalInput`: a dispatch's trigger,
      // retry and replan fields) is dropped before the check, exactly as the
      // proposal will drop it — #124's Restore card was refused for a
      // `replan: false` it had no business sending.
      const { withoutInternalInput } = await import('@/services/ActionService');
      const parsed = action.inputSchema.safeParse(withoutInternalInput(action, input));
      if (!parsed.success) {
        return `its input does not fit ${actionId}: ${parsed.error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`;
      }
      // A CARD IS PRESSED BY THE PERSON (conversation 411, 2026-10-01): pressing
      // it proposes the action as them (`Review.propose`, invokedBy the
      // person), so it is checked as them. Checked as the seat, the revert
      // card for a production outage was refused ("the pipeline's own move")
      // and never went up, though the person's press would have run it.
      const presser = ctx.userId && !ctx.missionRunId ? ctx.userId : `agent:${opts.agentSlug}`;
      return (await action.precheck?.({ orgId: opts.orgId, invokedBy: presser }, parsed.data)) || undefined;
    },
    repair: (actionId, input, label) => {
      const action = registry.getAction(actionId);
      return action ? repairCardInput(action, input, label, appBaseUrl()) : { input, repaired: [] };
    },
    requestExists: async (id) => {
      const { readRecord } = await import('@/libs/actions/factory-dispatch');
      return (await readRecord(opts.orgId, id))?.typeSlug === 'request';
    },
    threadRecordIds: async () => {
      if (!ctx.conversationId) {
        return [];
      }
      const { threadRecordIds } = await import('@/services/chat/turnRecords');
      return threadRecordIds(opts.orgId, ctx.conversationId);
    },
    filingTool: (objectType) => {
      const spec = (ctx.filingTypes ?? []).find(t => t.slug === objectType && (ctx.objectTypeSlugs ?? []).includes(t.slug));
      if (!spec) {
        return undefined;
      }
      // The schema only: the card is still a recommendation on the trust bar.
      const schemaOnly = tool(async () => '', { name: spec.toolName, description: `File one ${spec.label.toLowerCase()} record; the arguments ARE its fields.`, schema: filingSchema(spec) }) as unknown as StructuredToolInterface;
      return { tool: schemaOnly, input: args => filingInputOf(spec, args), label: spec.label.toLowerCase() };
    },
    charge: (role, response) => chargeModelCall({ orgId: opts.orgId, agentSlug: opts.agentSlug, feature: FEATURES.CHAT_CARDS, role, response }),
    record: row => persistToolCall({ ctx, tool: 'recommend_action', ns: '', ...row }),
    emit: opts.emit,
    callbacks: [handler],
  };
}

/**
 * A card's input as its action will take it: the fields a model may not
 * write (`internalInput`) dropped, as the proposal drops them, then the
 * repairs with one right answer (`repairActionInput`).
 * @param action - The card's action.
 * @param input - What the model sent.
 * @param label - The card's label.
 * @param baseUrl - The app's origin, for relative links.
 */
export function repairCardInput(action: Pick<Action, 'inputSchema' | 'internalInput'>, input: Record<string, unknown>, label: string, baseUrl: string): { input: Record<string, unknown>; repaired: string[] } {
  const internal = new Set(action.internalInput ?? []);
  const dropped = Object.keys(input).filter(k => internal.has(k));
  const own = dropped.length > 0 ? Object.fromEntries(Object.entries(input).filter(([k]) => !internal.has(k))) : input;
  const fixed = repairActionInput(action.inputSchema, own, { label, baseUrl });
  return dropped.length > 0 ? { input: fixed.input, repaired: [...fixed.repaired, ...dropped.map(k => `dropped internal ${k}`)] } : fixed;
}
