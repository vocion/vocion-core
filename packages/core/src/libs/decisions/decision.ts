/**
 * THE DECISION — one noun for everything a person is asked to decide.
 *
 * Vocion asked a person to decide through ten unrelated mechanisms, and every
 * answer re-entered the chat as a NEW user message that was routed and
 * intent-read like any other line. A Decision is the ask (`models/Schema.ts`,
 * `ask`), read as one shape wherever it is shown — docked above a chat
 * composer, as a row on Needs you, as a numbered message in Slack or email —
 * and answered with one typed answer, never with words that pretend the
 * person typed them.
 *
 *   question    the ask's title, one line
 *   options     each with its one-line consequence, the exact action it runs
 *               (its effect), and at most one recommended — drawn first and
 *               preselected
 *   allowOther  "Something else": a free-text answer
 *   skip        always offered: the asking agent carries on without an answer
 *   deadline    and its default, from the decision clock
 *   owner       the accountable person; the asking agent; the conversation
 *
 * Kinds map onto the ask's own vocabulary rather than adding one: an `input`
 * is a question, a `ruling` a choice, an `approval` an approval. States are
 * read off the row: open → answered | skipped | defaulted | expired |
 * withdrawn → undone (only where the effect's kind has undo).
 *
 * Pure and client-safe: the dock, the Needs you row and the server all read
 * a row through here. The service that raises and answers one is
 * `services/decisions/DecisionService.ts`.
 */

import { z } from 'zod';
import { DEFAULT_DECIDER } from '@/libs/needsYou/deadlines';

export const DECISION_KINDS = ['question', 'choice', 'approval', 'signoff', 'setup'] as const;
export type DecisionKind = typeof DECISION_KINDS[number];

export const DECISION_STATES = ['open', 'answered', 'skipped', 'defaulted', 'expired', 'withdrawn', 'undone'] as const;
export type DecisionState = typeof DECISION_STATES[number];

/** Where a Decision was answered. */
export const DECISION_CHANNELS = ['card', 'composer', 'needs_you', 'slack', 'email', 'default', 'agent'] as const;
export type DecisionChannel = typeof DECISION_CHANNELS[number];

/** One option as the card draws it. */
export type DecisionOption = {
  id: string;
  label: string;
  /** What choosing it does, in one line. */
  consequence?: string;
  recommended?: boolean;
  /** Choosing it runs an action (its effect), as the person who chose it. */
  hasEffect?: boolean;
};

/** A Decision as every surface draws it. */
export type DecisionView = {
  /** The ask's id. */
  id: number;
  kind: DecisionKind;
  question: string;
  /** Two to four lines of why — short, markdown. */
  body?: string | null;
  /** Recommended first. */
  options: DecisionOption[];
  allowOther: boolean;
  multiple: boolean;
  state: DecisionState;
  /** The agent that asked, by slug. */
  agentSlug: string | null;
  /** The accountable person. */
  ownerUserId: string | null;
  conversationId: number | null;
  /** When the default applies if nobody answers, and what it is. */
  deadline?: { at: string; defaultLabel: string | null } | null;
  /** What was answered, once it was. */
  answer?: DecisionAnswerRecord | null;
  /** The action the chosen option started, when it started one. */
  effectRunId?: number | null;
  createdAt?: string | null;
};

/** A person's answer: options by id, their own words, or a skip. */
export type DecisionAnswer
  = | { kind: 'option'; optionIds: string[] }
    | { kind: 'free_text'; text: string }
    | { kind: 'skip' };

/** An answer as it was recorded. */
export type DecisionAnswerRecord = {
  kind: DecisionAnswer['kind'];
  optionIds: string[];
  labels: string[];
  freeText: string | null;
  by: string | null;
  at: string | null;
  via: string | null;
};

/** The fields of an ask row a Decision is read from. A structural subset, so the client can pass a serialised row. */
export type AskLike = {
  id: number;
  kind: string;
  title: string;
  body?: string | null;
  options?: ReadonlyArray<{ id: string; label: string; description?: string; recommended?: boolean; action?: unknown }> | null;
  status: string;
  decision?: string | null;
  decisionNote?: string | null;
  decidedBy?: string | null;
  decidedAt?: Date | string | null;
  agentSlug?: string | null;
  ownerUserId?: string | null;
  conversationId?: number | null;
  allowOther?: boolean | null;
  multiSelect?: boolean | null;
  chosenOptionIds?: string[] | null;
  decidedVia?: string | null;
  effectRunId?: number | null;
  createdAt?: Date | string | null;
};

/**
 * The Decision's kind, read off the ask's own kind. A credential is a
 * question whose answer never travels through chat; a merge and a gate are
 * approvals; a recommendation is a choice with one option recommended.
 * @param askKind - The ask's `kind`.
 */
export function decisionKindOf(askKind: string): DecisionKind {
  switch (askKind) {
    case 'input':
    case 'credential':
      return 'question';
    case 'ruling':
    case 'recommendation':
      return 'choice';
    case 'signoff':
      return 'signoff';
    case 'setup':
      return 'setup';
    default:
      return 'approval';
  }
}

/** The two answers an approval with no named options always has. */
const APPROVAL_OPTIONS: DecisionOption[] = [
  { id: 'approve', label: 'Approve' },
  { id: 'reject', label: 'Reject' },
];

/**
 * The options as the card draws them: the recommended one first, each with
 * its consequence. An approval that named none answers Approve or Reject; a
 * question that named none is answered in the person's own words.
 * @param ask - The row.
 */
export function decisionOptionsOf(ask: Pick<AskLike, 'kind' | 'options'>): DecisionOption[] {
  const named: DecisionOption[] = (ask.options ?? []).map(o => ({
    id: String(o.id),
    label: String(o.label),
    ...(o.description ? { consequence: String(o.description) } : {}),
    ...(o.recommended ? { recommended: true } : {}),
    ...(o.action ? { hasEffect: true } : {}),
  }));
  const options = named.length > 0 ? named : decisionKindOf(ask.kind) === 'approval' ? APPROVAL_OPTIONS : [];
  return [...options.filter(o => o.recommended), ...options.filter(o => !o.recommended)];
}

/**
 * What became of a Decision, read off its row.
 * @param ask - The row.
 * @param extra - What the row alone cannot say.
 * @param extra.clockHeld - The deadline passed and no default could apply.
 * @param extra.effectUndone - The chosen option's effect was undone.
 */
export function decisionStateOf(ask: Pick<AskLike, 'status' | 'decidedBy'>, extra: { clockHeld?: boolean; effectUndone?: boolean } = {}): DecisionState {
  if (ask.status === 'open') {
    return extra.clockHeld ? 'expired' : 'open';
  }
  if (ask.status === 'skipped') {
    return 'skipped';
  }
  if (ask.status === 'superseded') {
    return 'withdrawn';
  }
  if (extra.effectUndone) {
    return 'undone';
  }
  return ask.decidedBy === DEFAULT_DECIDER ? 'defaulted' : 'answered';
}

/**
 * The answer a decided row records, or null while it is open.
 * @param ask - The row.
 * @param options - Its options, for the labels.
 */
function answerOf(ask: AskLike, options: DecisionOption[]): DecisionAnswerRecord | null {
  if (ask.status === 'open' || ask.status === 'superseded') {
    return null;
  }
  const at = ask.decidedAt ? new Date(ask.decidedAt).toISOString() : null;
  const base = { by: ask.decidedBy ?? null, at, via: ask.decidedVia ?? null };
  if (ask.status === 'skipped') {
    return { kind: 'skip', optionIds: [], labels: [], freeText: null, ...base };
  }
  if (ask.decision === 'other') {
    return { kind: 'free_text', optionIds: [], labels: [], freeText: ask.decisionNote ?? null, ...base };
  }
  const ids = ask.chosenOptionIds && ask.chosenOptionIds.length > 0 ? ask.chosenOptionIds : ask.decision ? [ask.decision] : [];
  const labels = ids.map(id => options.find(o => o.id === id)?.label ?? id);
  return { kind: 'option', optionIds: ids, labels, freeText: ask.decisionNote ?? null, ...base };
}

/**
 * A row as a Decision.
 * @param ask - The ask.
 * @param extra - What the row alone cannot say.
 * @param extra.deadline - The clock's deadline and default, when one runs.
 * @param extra.clockHeld - The deadline passed and no default could apply.
 * @param extra.effectUndone - The chosen option's effect was undone.
 */
export function decisionViewOf(ask: AskLike, extra: { deadline?: DecisionView['deadline']; clockHeld?: boolean; effectUndone?: boolean } = {}): DecisionView {
  const options = decisionOptionsOf(ask);
  const kind = decisionKindOf(ask.kind);
  return {
    id: ask.id,
    kind,
    question: ask.title,
    body: ask.body ?? null,
    options,
    // A question with no options can only be answered in words.
    allowOther: options.length === 0 ? true : ask.allowOther !== false,
    multiple: ask.multiSelect === true && options.length > 1,
    state: decisionStateOf(ask, extra),
    agentSlug: ask.agentSlug ?? null,
    ownerUserId: ask.ownerUserId ?? null,
    conversationId: ask.conversationId ?? null,
    ...(extra.deadline ? { deadline: extra.deadline } : {}),
    answer: answerOf(ask, options),
    effectRunId: ask.effectRunId ?? null,
    createdAt: ask.createdAt ? new Date(ask.createdAt).toISOString() : null,
  };
}

/**
 * Why this answer cannot answer this Decision, or null when it can. The one
 * check the card, the composer's model read and every channel share.
 * @param view - The Decision.
 * @param answer - The answer.
 */
export function answerProblem(view: Pick<DecisionView, 'options' | 'allowOther' | 'multiple' | 'state'>, answer: DecisionAnswer): string | null {
  if (view.state !== 'open' && view.state !== 'expired') {
    return 'it was already decided';
  }
  if (answer.kind === 'skip') {
    return null;
  }
  if (answer.kind === 'free_text') {
    if (!answer.text.trim()) {
      return 'an answer in your own words cannot be empty';
    }
    return view.allowOther ? null : 'this decision takes one of its options';
  }
  if (answer.optionIds.length === 0) {
    return 'choose an option';
  }
  const unknown = answer.optionIds.filter(id => !view.options.some(o => o.id === id));
  if (unknown.length > 0) {
    return `no such option: ${unknown.join(', ')}`;
  }
  if (!view.multiple && answer.optionIds.length > 1) {
    return 'this decision takes one option';
  }
  if (new Set(answer.optionIds).size !== answer.optionIds.length) {
    return 'an option was chosen twice';
  }
  return null;
}

/**
 * The answer in one line, as the transcript's receipt reads it.
 * @param view - The Decision.
 * @param answer - The answer.
 */
export function answerLine(view: Pick<DecisionView, 'options'>, answer: DecisionAnswer): string {
  if (answer.kind === 'skip') {
    return 'Skipped';
  }
  if (answer.kind === 'free_text') {
    return answer.text.trim();
  }
  return answer.optionIds.map(id => view.options.find(o => o.id === id)?.label ?? id).join(', ');
}

/**
 * The typed decision event as the asking agent reads it. Not words the
 * person typed — the record of what they chose, shaped so the agent binds it
 * to the question it asked, by id.
 * @param view - The Decision, as it was asked.
 * @param answer - The answer.
 */
export function decisionForModel(view: Pick<DecisionView, 'id' | 'question' | 'options'>, answer: DecisionAnswer): string {
  const lines = [`[decision #${view.id} answered] ${view.question}`];
  if (answer.kind === 'skip') {
    lines.push('Skipped: the person chose not to answer. Carry on without it — with your recommendation where that is within bounds — and say in one line what you did instead.');
  } else if (answer.kind === 'free_text') {
    lines.push(`Answered in their own words: ${answer.text.trim()}`);
  } else {
    for (const id of answer.optionIds) {
      const o = view.options.find(x => x.id === id);
      lines.push(`Chosen: ${o?.label ?? id} (option ${id})${o?.hasEffect ? ' — its action ran as theirs' : ''}`);
    }
  }
  lines.push('This is their answer to the question you asked. Act on it now; do not ask it again.');
  return lines.join('\n');
}

/**
 * The answer a client sends: a Decision id and one of options, free text or
 * skip. The wire shape the stream route and every channel read.
 */
export const DecisionAnswerWireSchema = z.object({
  id: z.number().int().positive(),
  option_ids: z.array(z.string().min(1).max(80)).max(8).optional(),
  free_text: z.string().max(4_000).optional(),
  skip: z.boolean().optional(),
});
export type DecisionAnswerWire = z.infer<typeof DecisionAnswerWireSchema>;

/**
 * Read an answer off the wire, or null when it is not one. Exactly one of
 * the three must be present.
 * @param raw - Whatever the client sent.
 */
export function readDecisionAnswerWire(raw: unknown): { id: number; answer: DecisionAnswer } | null {
  const parsed = DecisionAnswerWireSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const { id, option_ids, free_text, skip } = parsed.data;
  const given = [skip === true, (option_ids?.length ?? 0) > 0, typeof free_text === 'string' && free_text.trim().length > 0].filter(Boolean).length;
  if (given !== 1) {
    return null;
  }
  if (skip) {
    return { id, answer: { kind: 'skip' } };
  }
  if (option_ids && option_ids.length > 0) {
    return { id, answer: { kind: 'option', optionIds: option_ids } };
  }
  return { id, answer: { kind: 'free_text', text: free_text!.trim() } };
}

/**
 * An answer as the wire carries it.
 * @param id - The Decision.
 * @param answer - The answer.
 */
export function decisionAnswerWire(id: number, answer: DecisionAnswer): DecisionAnswerWire {
  if (answer.kind === 'skip') {
    return { id, skip: true };
  }
  if (answer.kind === 'free_text') {
    return { id, free_text: answer.text };
  }
  return { id, option_ids: answer.optionIds };
}
