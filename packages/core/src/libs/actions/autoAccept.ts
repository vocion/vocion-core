/**
 * Done for you, by default — the execution policy for a proposed action.
 *
 * Chris, 2026-09-18: "everything should have a confidence score that
 * automatically accepts, with the ability to undo. If we're really unsure,
 * ask. The default should be DONE FOR YOU with visibility and the ability to
 * edit or undo." Until this, the default rung for every action kind was
 * Execute with approval and nothing ran without a click unless a person had
 * authored a trust rule — so the review queue sat at 99+ and one run reached
 * its 115th check with no decision.
 *
 * Autonomy is still earned (design value 4). What changes is the mechanism at
 * the bottom of the ladder: a kind that is REVERSIBLE (its action declares
 * `undo`) and LOW-RISK executes on its own once the agent's confidence clears
 * the kind's threshold, and every such run is visible with Undo one move
 * away. Irreversible kinds, never-auto kinds, and anything a person has
 * parked below the default still ask. A workspace changes the numbers in
 * `trust.yaml`; a rejection or an undo still demotes through the ladder.
 *
 * Pure: no database, no registry. `ActionService` gathers the facts and asks.
 */

import type { RiskTier, Rung } from '@/services/autonomy/rungs';
import { DEFAULT_RUNG, rungAutomates, rungIndex } from '@/services/autonomy/rungs';

/** The confidence a reversible, low-risk kind needs before it runs on its own with nothing else said. */
export const DEFAULT_AUTO_ACCEPT_CONFIDENCE = 0.8;

/**
 * Per-kind defaults where 0.8 is not the right bar. One table, read here
 * only; a `trust.yaml` rule for the kind wins over it.
 */
export const DEFAULT_AUTO_ACCEPT: Readonly<Record<string, number>> = {
  'hubspot.update': 0.8,
};

export type ExecutionDecision = {
  mode: 'execute' | 'ask';
  /** Why, in one clause a person can read on the run: "reversible, low-risk, 91% ≥ 80%". */
  reason: string;
  /** The bar the confidence was measured against, when one applied. */
  threshold: number | null;
  /** Which rule decided: the trust ladder's rule, the platform default, or a hold. */
  source: 'never-auto' | 'advice' | 'no-confidence' | 'conversation' | 'parked' | 'trust-rule' | 'default' | 'held';
};

export type ExecutionFacts = {
  actionId: string;
  /** The agent's confidence, 0–1; undefined when the proposer gave none. */
  confidence?: number;
  /** Whether the action declares `undo` — the only thing "reversible" means here. */
  reversible: boolean;
  /** Held at approval by the platform (`libs/actions/neverAuto.ts`). */
  neverAuto: boolean;
  /** The agent's own advice about the item; a reject or snooze is never run. */
  suggestedDecision?: 'approve' | 'reject' | 'snooze' | null;
  /** Where the kind stands on the ladder and what its rule says. */
  rung: Rung;
  riskTier: RiskTier;
  /** The trust rule's floor when the rung automates. */
  minConfidence: number;
  /** True when a person or `trust.yaml` has said anything about this kind — then the default stays out of it. */
  explicit: boolean;
  /** The conversation's own rung, when the proposal came from a thread that has one. */
  conversationAutonomy?: 'ask' | 'act';
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Execute now, or ask a person?
 * @param f - The facts about this proposal and its kind.
 */
export function decideExecution(f: ExecutionFacts): ExecutionDecision {
  if (f.neverAuto) {
    return { mode: 'ask', reason: 'held at approval by the platform: this reaches a real person or publishes outside', threshold: null, source: 'never-auto' };
  }
  if (f.suggestedDecision === 'reject' || f.suggestedDecision === 'snooze') {
    return { mode: 'ask', reason: `the agent itself advised "${f.suggestedDecision}"`, threshold: null, source: 'advice' };
  }
  if (typeof f.confidence !== 'number' || Number.isNaN(f.confidence)) {
    return { mode: 'ask', reason: 'no confidence was given', threshold: null, source: 'no-confidence' };
  }
  if (f.conversationAutonomy === 'ask') {
    return { mode: 'ask', reason: 'this conversation is set to ask before acting', threshold: null, source: 'conversation' };
  }
  if (rungIndex(f.rung) < rungIndex(DEFAULT_RUNG)) {
    return { mode: 'ask', reason: `parked at ${f.rung} by a person`, threshold: null, source: 'parked' };
  }
  if (rungAutomates(f.rung)) {
    return f.confidence >= f.minConfidence
      ? { mode: 'execute', reason: `trust rule: ${pct(f.confidence)} ≥ ${pct(f.minConfidence)}`, threshold: f.minConfidence, source: 'trust-rule' }
      : { mode: 'ask', reason: `trust rule: ${pct(f.confidence)} is under the ${pct(f.minConfidence)} floor`, threshold: f.minConfidence, source: 'trust-rule' };
  }
  // The default, for a kind nobody has said anything about: reversible and
  // low-risk runs on its own above the bar, with Undo one move away.
  if (!f.explicit && f.reversible && f.riskTier === 'low') {
    const threshold = DEFAULT_AUTO_ACCEPT[f.actionId] ?? DEFAULT_AUTO_ACCEPT_CONFIDENCE;
    return f.confidence >= threshold
      ? { mode: 'execute', reason: `reversible, low-risk, ${pct(f.confidence)} ≥ ${pct(threshold)} — done for you, undo any time`, threshold, source: 'default' }
      : { mode: 'ask', reason: `${pct(f.confidence)} is under the ${pct(threshold)} bar for a reversible kind`, threshold, source: 'default' };
  }
  const why = !f.reversible
    ? 'cannot be undone'
    : f.riskTier !== 'low'
      ? `${f.riskTier}-risk`
      : 'a person set this kind to ask';
  return { mode: 'ask', reason: `${why}: a person decides`, threshold: null, source: 'held' };
}
