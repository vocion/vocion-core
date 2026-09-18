/**
 * The attention budget, as code (`docs/specs/briefing-v2.md` — "Content rules
 * to bake into Vocion itself").
 *
 * > A briefing has a hard attention budget: ~5 major items above the fold; no
 * > more than 3 items that "need you" unless there is a genuine incident.
 *
 * These are constants with tests, not a sentence in a prompt. The composer
 * applies them before the document is stored and the renderer re-applies them
 * on the way out, so a hand-written or model-written document cannot spend
 * more of a person's attention than the product allows.
 *
 * Pure — no database, no React, no clock.
 */

import type { BriefingChange, BriefingDecision, BriefingHistoryEntry, BriefingMetric, BriefingV2, CriticalPathItem } from './document';

/** `today` shows at most this many metrics (spec IA row 1: "3 to 5 metrics with deltas"). */
export const MAX_TODAY_METRICS = 5;

/** At most this many cards "need you" — the 4th and beyond must be an incident. */
export const MAX_DECISIONS = 3;

/**
 * The whole above-the-fold budget: decision cards plus change lines. Decisions
 * are never trimmed to make room for changes; changes fold instead, so the
 * thing that needs a person always wins the space.
 */
export const MAX_ABOVE_FOLD_ITEMS = 5;

/** History shows the last few briefings and then hands off to the archive. */
export const MIN_HISTORY_ENTRIES = 3;
export const MAX_HISTORY_ENTRIES = 5;

/**
 * Trim `today` to the budget, highest-ranked first. Metrics arrive ranked;
 * this only enforces the ceiling.
 * @param metrics - Ranked metrics.
 */
export function capMetrics(metrics: BriefingMetric[]): BriefingMetric[] {
  return metrics.slice(0, MAX_TODAY_METRICS);
}

/**
 * The cards that may show, and why any of them exceed the budget.
 *
 * The first {@link MAX_DECISIONS} always show. Past that, only cards marked
 * `incident` survive — and they come back with the reason attached so the
 * renderer can say out loud why it is showing a 4th card rather than quietly
 * blowing the budget (spec §2 + Content rules).
 * @param cards - Ranked decision cards.
 */
export function capDecisions(cards: BriefingDecision[]): { shown: BriefingDecision[]; overBudget: BriefingDecision[]; dropped: BriefingDecision[] } {
  const within = cards.slice(0, MAX_DECISIONS);
  const rest = cards.slice(MAX_DECISIONS);
  const overBudget = rest.filter(c => c.incident);
  const dropped = rest.filter(c => !c.incident);
  return { shown: [...within, ...overBudget], overBudget, dropped };
}

/**
 * How many change lines fit beside the decisions. Never negative, and never
 * more than there are: a brief with 3 decisions shows 2 changes and folds the
 * rest behind a disclosure — folded, not deleted (manifesto §12).
 * @param decisionCount - Cards actually being shown, incidents included.
 */
export function changeSlots(decisionCount: number): number {
  return Math.max(0, MAX_ABOVE_FOLD_ITEMS - decisionCount);
}

/**
 * Split the change list at the budget.
 * @param changes - Ranked changes.
 * @param decisionCount - Cards actually being shown.
 */
export function splitChanges(changes: BriefingChange[], decisionCount: number): { shown: BriefingChange[]; folded: BriefingChange[] } {
  const slots = changeSlots(decisionCount);
  return { shown: changes.slice(0, slots), folded: changes.slice(slots) };
}

/**
 * Total items competing for the first screen. The test that keeps this honest
 * asserts it never exceeds {@link MAX_ABOVE_FOLD_ITEMS} unless an incident
 * pushed it there.
 * @param decisionCount - Cards shown.
 * @param changeCount - Change lines shown.
 */
export function aboveFoldCount(decisionCount: number, changeCount: number): number {
  return decisionCount + changeCount;
}

/**
 * The last few briefings. "Show the last 3 to 5. Then View all briefings."
 * @param entries - Newest first.
 */
export function capHistory(entries: BriefingHistoryEntry[]): BriefingHistoryEntry[] {
  return entries.slice(0, MAX_HISTORY_ENTRIES);
}

/**
 * The first screen, decided here and nowhere else.
 *
 * The page, the mail and the validator all call this, so "what is above the
 * fold" has exactly one definition and the budget cannot be spent twice. The
 * document keeps every computed change; this function decides which of them
 * fit beside the decisions and which fold behind a disclosure — folded, not
 * deleted (manifesto §12).
 * @param doc - The document.
 */
export function firstScreen(doc: BriefingV2): {
  metrics: BriefingMetric[];
  decisions: BriefingDecision[];
  overBudget: BriefingDecision[];
  changes: BriefingChange[];
  foldedChanges: BriefingChange[];
  criticalPath: CriticalPathItem[];
} {
  const metrics = capMetrics(doc.today?.metrics ?? []);
  const { shown: decisions, overBudget } = capDecisions(doc.decisions?.judgment ?? []);
  // Incidents are the exception the spec grants; they do not eat the change budget.
  const { shown: changes, folded } = splitChanges(doc.changes?.items ?? [], decisions.length - overBudget.length);
  return { metrics, decisions, overBudget, changes, foldedChanges: folded, criticalPath: doc.criticalPath?.items ?? [] };
}

/**
 * "3 decisions need you today · 658 lower-priority items queued"* — the
 * headline, derived. N is the judgment count; M is everything else. The raw
 * queue count is never the headline (spec §2), which is why this function
 * takes the split and not a total.
 * @param judgment - Cards needing judgment today.
 * @param queued - Batchable + background remainder.
 */
export function decisionHeadline(judgment: number, queued: number): string {
  const left = judgment === 0
    ? 'Nothing needs your judgment today'
    : `${judgment} ${judgment === 1 ? 'decision needs' : 'decisions need'} you today`;
  if (queued === 0) {
    return left;
  }
  return `${left} · ${queued} lower-priority ${queued === 1 ? 'item' : 'items'} queued`;
}
