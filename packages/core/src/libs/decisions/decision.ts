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

/**
 * What a Decision is a reading of: an `ask` (a question, a choice, a sign-off,
 * a setup step — the ask row is the record), or a `proposal` — a pending
 * action_run, which IS the record of its own approval. Ids are per subject, so
 * a Decision is keyed by both (`decisionKey`).
 */
export const DECISION_SUBJECTS = ['ask', 'proposal'] as const;
export type DecisionSubject = typeof DECISION_SUBJECTS[number];

/** One option as the card draws it. */
export type DecisionOption = {
  id: string;
  label: string;
  /** What choosing it does, in one line. */
  consequence?: string;
  recommended?: boolean;
  /** Choosing it runs an action (its effect), as the person who chose it. */
  hasEffect?: boolean;
  /**
   * Choosing it OPENS this in-app path instead of answering (a login, a token
   * form). The Decision stays open; the flow it opens answers it on return.
   */
  href?: string;
};

/** A Decision as every surface draws it. */
export type DecisionView = {
  /** The ask's id, or the proposal's (action run) id — see `subject`. */
  id: number;
  /** What it reads: an ask (the default) or a pending proposal. */
  subject?: DecisionSubject;
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
  /** The long form, one move away: an in-app path (the record, the run, the artifact). */
  href?: string | null;
  /** What the link says. */
  hrefLabel?: string | null;
  /** The records it is about. */
  refs?: Array<{ type: string; id: string }>;
  /**
   * An approval's exact payload, as the person will be held to it — the
   * email's body, the record's diff, the command. Plain text, drawn as is.
   */
  preview?: string | null;
};

/** The option that runs it this once. */
export const ALLOW_ONCE_ID = 'approve';
/** The option that moves the action kind up the trust ladder, then runs it. */
export const ALWAYS_ALLOW_ID = 'always';
/** The option that turns it down. */
export const DENY_ID = 'reject';

/**
 * The title an approval is asked under, the way a permission prompt asks:
 * "Allow Revenue lead to move Northwind to Negotiation?". A question already
 * phrased as one ("Send the follow-up to Northwind?") is kept as it is.
 * @param view - The Decision.
 * @param view.kind - Its kind.
 * @param view.question - What it asks.
 * @param agentName - The asking agent's name, when known.
 */
export function decisionTitle(view: Pick<DecisionView, 'kind' | 'question'>, agentName: string | null | undefined): string {
  const q = view.question.trim();
  if (view.kind !== 'approval' || !q || q.endsWith('?')) {
    return q;
  }
  // "Move Northwind…" reads "move Northwind…"; "HubSpot: update…" keeps its capital.
  const plain = /^[A-Z][a-z]+(?=[\s,.:;]|$)/.test(q) ? `${q[0]!.toLowerCase()}${q.slice(1)}` : q;
  return `Allow ${agentName?.trim() || 'the agent'} to ${plain.replace(/[.!]+$/, '')}?`;
}

/**
 * The text an approval's preview shows, from the fenced block a payload is
 * stored as (`contextMd`): the fence is the storage, not the content.
 * @param md - The stored context.
 */
export function previewText(md: string | null | undefined): string | null {
  const t = md?.trim();
  if (!t) {
    return null;
  }
  const fenced = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(t);
  return (fenced ? fenced[1]! : t).slice(0, 4_000);
}

/**
 * The one key a Decision is known by on a surface: its subject and its id.
 * @param view - The Decision.
 * @param view.subject - Ask or proposal.
 * @param view.id - Its id.
 */
export function decisionKey(view: Pick<DecisionView, 'subject' | 'id'>): string {
  return `${view.subject ?? 'ask'}:${view.id}`;
}

/**
 * An in-app path, or null — a Decision links only inside the app (a context
 * URL may be any https page; the card shows only what it can open in place).
 * @param raw - A candidate.
 */
export function inAppHref(raw: unknown): string | null {
  return typeof raw === 'string' && /^\/(?!\/)/.test(raw) && !raw.includes('\\') ? raw : null;
}

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
  options?: ReadonlyArray<{ id: string; label: string; description?: string; recommended?: boolean; action?: unknown; href?: string }> | null;
  contextUrl?: string | null;
  /** An approval's payload, fenced (`previewText`). */
  contextMd?: string | null;
  objectRefs?: ReadonlyArray<{ type: string; id: string }> | null;
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
  { id: ALLOW_ONCE_ID, label: 'Allow once', consequence: 'It goes ahead, this once.', recommended: true },
  { id: DENY_ID, label: 'Deny', consequence: 'It does not happen.' },
];

/**
 * A sign-off: approve it, discard it — or revise it, which is the answer in
 * their own words ("Revise — say what to change"). The ids are the ask's own
 * fixed answers, so an ask filed with no options still resolves.
 */
const SIGNOFF_OPTIONS: DecisionOption[] = [
  { id: 'approve', label: 'Approve', consequence: 'Marks it approved, as it stands.', recommended: true },
  { id: 'reject', label: 'Discard', consequence: 'Nothing is kept or sent.' },
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
    ...(inAppHref(o.href) ? { href: o.href } : {}),
  }));
  const kind = decisionKindOf(ask.kind);
  const options = named.length > 0 ? named : kind === 'approval' ? APPROVAL_OPTIONS : kind === 'signoff' ? SIGNOFF_OPTIONS : [];
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
    subject: 'ask',
    ...(inAppHref(ask.contextUrl) ? { href: ask.contextUrl } : {}),
    ...(kind === 'approval' && previewText(ask.contextMd) ? { preview: previewText(ask.contextMd) } : {}),
    ...((ask.objectRefs?.length ?? 0) > 0 ? { refs: ask.objectRefs!.map(r => ({ type: r.type, id: String(r.id) })) } : {}),
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
export function decisionForModel(view: Pick<DecisionView, 'id' | 'question' | 'options' | 'subject' | 'body' | 'refs'>, answer: DecisionAnswer): string {
  const lines = [`[${view.subject === 'proposal' ? 'proposal' : 'decision'} #${view.id} answered] ${view.question}`];
  if (view.body?.trim()) {
    lines.push(`Asked with: ${view.body.trim()}`);
  }
  if (view.refs && view.refs.length > 0) {
    lines.push(`About: ${view.refs.map(r => `${r.type} #${r.id}`).join(', ')}`);
  }
  if (answer.kind === 'skip') {
    lines.push('Skipped: the person chose not to answer. Carry on without it — with your recommendation where that is within bounds — and say in one line what you did instead.');
  } else if (answer.kind === 'free_text') {
    lines.push(`Answered in their own words: ${answer.text.trim()}`);
  } else {
    for (const id of answer.optionIds) {
      const o = view.options.find(x => x.id === id);
      const did = o?.hasEffect ? 'its action ran as theirs' : o?.consequence ?? '';
      lines.push(`Chosen: ${o?.label ?? id} (option ${id})${did ? ` — ${did}` : ''}`);
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
  subject: z.enum(DECISION_SUBJECTS).optional(),
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
export function readDecisionAnswerWire(raw: unknown): { id: number; subject: DecisionSubject; answer: DecisionAnswer } | null {
  const parsed = DecisionAnswerWireSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const { id, option_ids, free_text, skip } = parsed.data;
  const subject = parsed.data.subject ?? 'ask';
  const given = [skip === true, (option_ids?.length ?? 0) > 0, typeof free_text === 'string' && free_text.trim().length > 0].filter(Boolean).length;
  if (given !== 1) {
    return null;
  }
  if (skip) {
    return { id, subject, answer: { kind: 'skip' } };
  }
  if (option_ids && option_ids.length > 0) {
    return { id, subject, answer: { kind: 'option', optionIds: option_ids } };
  }
  return { id, subject, answer: { kind: 'free_text', text: free_text!.trim() } };
}

/**
 * An answer as the wire carries it.
 * @param view - The Decision: its id and subject.
 * @param view.id - Its id.
 * @param view.subject - Ask or proposal.
 * @param answer - The answer.
 */
export function decisionAnswerWire(view: Pick<DecisionView, 'id' | 'subject'>, answer: DecisionAnswer): DecisionAnswerWire {
  const at = { id: view.id, ...(view.subject === 'proposal' ? { subject: 'proposal' as const } : {}) };
  if (answer.kind === 'skip') {
    return { ...at, skip: true };
  }
  if (answer.kind === 'free_text') {
    return { ...at, free_text: answer.text };
  }
  return { ...at, option_ids: answer.optionIds };
}
