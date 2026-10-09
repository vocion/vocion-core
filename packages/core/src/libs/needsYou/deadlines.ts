/**
 * The clock on a decision waiting on Needs you — pure, safe on the client.
 *
 * Vocion's own zero-person company stopped with 24 approvals that nobody
 * approved or rejected. Each ask had no deadline, no default, nobody it went
 * to when it sat, and no way to be accepted alongside the others like it. So
 * every ask and every agent proposal waiting on a person now has:
 *
 *   - a DEADLINE: the asker's `dueAt` when it gave one, else a window by risk;
 *   - a DEFAULT: the asker's recommended option (a proposal's own suggested
 *     decision) — what happens if nobody answers;
 *   - an ESCALATION before the deadline to the person accountable for it;
 *   - at the deadline, the default APPLIES as a recorded decision — but only
 *     where the trust ladder would let that kind run without a person, or the
 *     default can be undone. Otherwise it stays, and is escalated again.
 *
 * This module is the policy: numbers and verdicts, no database. The sweep that
 * acts on it is `services/needsYou/DecisionClockService.ts`.
 */

import type { RiskTier, Rung } from '@/services/autonomy/rungs';
import { DEFAULT_RUNG, rungAutomates, rungIndex } from '@/services/autonomy/rungs';

/**
 * Who decided a default that applied at its deadline. Never a person, so
 * nothing runs as one, nothing counts as alignment evidence, and the decided
 * tab can say "applied by default" rather than naming someone.
 */
export const DEFAULT_DECIDER = 'by-default';

/** What the clock is on: an `ask`, or a pending `action_run` (a proposal). */
export const CLOCK_SUBJECTS = ['ask', 'proposal'] as const;
export type ClockSubject = typeof CLOCK_SUBJECTS[number];

/** `open` · `held` · `applied` · `settled` — see `decision_deadline` in `models/Schema.ts`. */
export const CLOCK_STATUSES = ['open', 'held', 'applied', 'settled'] as const;
export type ClockStatus = typeof CLOCK_STATUSES[number];

/**
 * How long a decision may wait before its default applies, by how much rides
 * on it. A day for something low-risk, three for medium, a week for high. One
 * table, read here only; a filer that needs another date says so with `dueAt`.
 */
export const DECISION_WINDOW_HOURS: Readonly<Record<RiskTier, number>> = { low: 24, medium: 72, high: 168 };

/** The owner hears about it this share of the window before the deadline. */
export const NOTICE_SHARE = 0.25;

/** However short the window, a person always has at least this long between being told and the default applying. */
export const MIN_NOTICE_MS = 60 * 60_000;

/** A decision still waiting after its deadline is escalated again this often. */
export const RE_ESCALATE_MS = 24 * 60 * 60_000;

/**
 * Whether an agent-advised decline of this proposal waits for a person at its
 * deadline instead of applying on its own.
 *
 * `VOCION_HOLD_DECLINES` lists action ids or per-input policy keys, comma
 * separated (`objects.propose_candidate.event-candidate`). An action id covers
 * every key derived from it. For an installation whose agent proposes records
 * for people to review: there the agent's "decline" is a reading of the record,
 * and the review exists to catch the times it is wrong. Unset holds nothing.
 * @param actionId - The proposal's action.
 * @param policyKey - Its per-input key (`policyKeyForRun`), or the action id.
 */
export function declineHeldForPerson(actionId: string, policyKey: string): boolean {
  const listed = (process.env.VOCION_HOLD_DECLINES ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return listed.some(entry => entry === policyKey || entry === actionId);
}

const HOUR = 60 * 60_000;

/**
 * `low` | `medium` | `high` from whatever the subject carried, else `low`.
 * @param value - The stored risk.
 */
export function riskTierOf(value: string | null | undefined): RiskTier {
  return value === 'medium' || value === 'high' ? value : 'low';
}

/**
 * The deadline and the escalation for one decision, at the moment its clock
 * opens.
 *
 * The rule a backlog depends on: nothing applies without warning. A decision
 * older than its window when the clock first sees it — the 53-day-old
 * approval — is not defaulted on the spot; its deadline is pushed out to a
 * full notice from now, and it is escalated first. An explicit `dueAt` is
 * honoured, never earlier than an hour from now for the same reason.
 * @param opts - What the clock knows.
 * @param opts.createdAt - When it started waiting.
 * @param opts.dueAt - The asker's own deadline, when it gave one.
 * @param opts.risk - How much rides on it.
 * @param opts.now - The clock.
 */
export function clockFor(opts: { createdAt: Date; dueAt?: Date | null; risk: RiskTier; now: Date }): { deadlineAt: Date; escalateAt: Date } {
  const windowMs = DECISION_WINDOW_HOURS[opts.risk] * HOUR;
  const notice = Math.max(MIN_NOTICE_MS, windowMs * NOTICE_SHARE);
  const now = opts.now.getTime();
  const deadline = opts.dueAt
    ? Math.max(opts.dueAt.getTime(), now + MIN_NOTICE_MS)
    : Math.max(opts.createdAt.getTime() + windowMs, now + notice);
  // The notice shrinks to what is left when the asker set a close date; it
  // never makes the escalation late.
  const escalate = Math.max(now, deadline - Math.min(notice, deadline - now));
  return { deadlineAt: new Date(deadline), escalateAt: new Date(escalate) };
}

/** Everything the deadline verdict needs to know. */
export type DefaultFacts = {
  /** The declared default — an option id, or `approve` / `reject`. Null = none declared. */
  defaultOption: string | null;
  /** The default runs nothing (a proposal the agent itself advised turning down). */
  inert: boolean;
  /** Held at approval by the platform (`libs/actions/neverAuto.ts`). */
  neverAuto: boolean;
  /** The record's own hard stop (`Action.holdForPerson`), when it has one. */
  heldForPerson: string | null;
  /** Where the kind stands on the ladder. */
  rung: Rung;
  riskTier: RiskTier;
  /** The default can be put back — the action's `undo`, or a reopened ask. */
  reversible: boolean;
  /** A person already took a default back on this decision. */
  undone: boolean;
  /** How many times the owner has been told. */
  escalations: number;
};

export type DefaultVerdict = {
  mode: 'apply' | 'hold';
  /** One clause, where the decision is read: why it applied, or why it waits. */
  reason: string;
  /** What allowed it: the ladder, reversibility, or that it runs nothing. Null when held. */
  basis: 'ladder' | 'reversible' | 'inert' | null;
};

/**
 * At the deadline: does the default apply, or does the decision stay with a
 * person? Fails safe in every branch — it can only keep a decision waiting.
 *
 * Applies when the trust ladder would let this kind run without a person at
 * its current rung, or when the default can be undone and the kind is not
 * high-risk. Never when the platform holds the kind, a person parked it below
 * the default rung, the record holds itself for a person, there is no
 * default, a person already took the default back, or nobody was told.
 * @param f - The facts.
 */
export function defaultVerdict(f: DefaultFacts): DefaultVerdict {
  if (f.undone) {
    return { mode: 'hold', reason: 'a person took the default back, so it waits for their answer', basis: null };
  }
  if (!f.defaultOption) {
    return { mode: 'hold', reason: 'no recommended answer was given, so nothing can apply on its own', basis: null };
  }
  if (f.escalations < 1) {
    return { mode: 'hold', reason: 'nobody has been told about it yet', basis: null };
  }
  if (f.inert) {
    return { mode: 'apply', reason: 'nothing runs: it was turned down as the agent advised', basis: 'inert' };
  }
  if (f.neverAuto) {
    return { mode: 'hold', reason: 'held at approval by the platform: a person decides', basis: null };
  }
  if (f.heldForPerson) {
    return { mode: 'hold', reason: f.heldForPerson, basis: null };
  }
  if (rungIndex(f.rung) < rungIndex(DEFAULT_RUNG)) {
    return { mode: 'hold', reason: `parked at ${f.rung} by a person`, basis: null };
  }
  if (rungAutomates(f.rung)) {
    return { mode: 'apply', reason: `the trust ladder lets this kind run without a person (${f.rung})`, basis: 'ladder' };
  }
  if (f.reversible && f.riskTier !== 'high') {
    return { mode: 'apply', reason: `${f.riskTier}-risk and reversible — Undo puts it back`, basis: 'reversible' };
  }
  return {
    mode: 'hold',
    reason: !f.reversible ? 'it cannot be undone, and the trust ladder keeps it for a person' : 'high-risk: the trust ladder keeps it for a person',
    basis: null,
  };
}

/** A proposal's suggested decision as the default a person reads. Snooze is not a default. */
export const PROPOSAL_DEFAULTS: Readonly<Record<'approve' | 'reject', string>> = { approve: 'Approve', reject: 'Decline' };

/**
 * The key a batch is gathered under: the recommended option as a person reads
 * it, so every item whose recommendation reads "Approve" is one batch whatever
 * produced it. Case and spacing do not split a batch.
 * @param label - The recommended option's label.
 */
export function batchKeyFor(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * "in 5h", "in 2d", "3h ago" — how far a deadline is from now, for a row.
 * @param at - The deadline.
 * @param now - The clock.
 */
export function deadlineDistance(at: Date, now: Date = new Date()): string {
  const ms = at.getTime() - now.getTime();
  const abs = Math.abs(ms);
  const label = abs >= 48 * HOUR ? `${Math.round(abs / (24 * HOUR))}d` : abs >= HOUR ? `${Math.round(abs / HOUR)}h` : `${Math.max(1, Math.round(abs / 60_000))}m`;
  return ms >= 0 ? `in ${label}` : `${label} ago`;
}
