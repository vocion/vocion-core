/**
 * How eager this workspace is to improve itself — one dial, 0 to 10.
 *
 * Chris, 2026-09-20: *"overall, we want the system eager and learning and
 * getting to automation. Maybe that can be a coefficient setting in each
 * workspace, defaulting to 7/10?"*
 *
 * The dial moves the confidence bar for the class of actions that change what
 * the SYSTEM knows about how to work — a rule it adopts from a correction, a
 * standing preference it files. Those are the ones a workspace can reasonably
 * be more or less adventurous about, because every one of them is reversible
 * and none of them reaches outside: the blast radius of a wrong one is that an
 * agent reads a sentence nobody meant until a person clicks Undo.
 *
 * **It moves the bar, never the judgement.** The confidence still comes from
 * what the person actually said (`services/chat/workCorrections.ts`: 0.9 for
 * an unhedged directive in their own words, 0.5 for a hedge, an aside, or a
 * rule the model had to infer). A workspace at 10 therefore still asks about
 * an inferred rule — it has simply stopped asking about the plain ones.
 *
 * **The formula**, monotonic and deliberately dull:
 *
 *     bar(0)  = 1.01                      — above any confidence: always ask
 *     bar(e)  = 0.96 − (e − 1) × 0.04     — for 1 ≤ e ≤ 10
 *
 * which puts the shipped default, 7, at **0.72**, and the most eager setting,
 * 10, at **0.60**. Both clear a plain directive (0.9) and neither clears a
 * hedged one (0.5) — the difference between them shows up on the middle
 * ground a future extractor will produce, and on the day someone lowers the
 * dial because a rule they did not want got adopted.
 *
 * Precedence: a trust rule that names a threshold for a kind
 * (`autoApproveAbove` in trust.yaml, or a promoted autonomy policy) wins over
 * the dial entirely. `decideExecution` reads the dial only on the default
 * branch — the one taken when nobody has said anything about this kind.
 */

/** What a workspace gets when `defaults.learningEagerness` is unset. */
export const DEFAULT_LEARNING_EAGERNESS = 7;

/** The dial's range. */
export const MIN_LEARNING_EAGERNESS = 0;
export const MAX_LEARNING_EAGERNESS = 10;

/** A bar no confidence can clear — what 0 means. */
export const ALWAYS_ASK_BAR = 1.01;

/** The bar at 1: almost everything is still a person's call. */
export const LEAST_EAGER_BAR = 0.96;

/** How much each notch of the dial lowers the bar. */
export const EAGERNESS_STEP = 0.04;

/**
 * The confidence bar a self-improving action must clear to run on its own.
 *
 * Pure, total and monotonic: a higher dial is never a higher bar. An unset,
 * out-of-range or non-integer value falls back to the shipped default rather
 * than throwing — a bad number in a YAML file must not stop an agent working.
 * @param eagerness - `defaults.learningEagerness`, 0–10, or undefined.
 */
export function selfImprovementBar(eagerness?: number | null): number {
  const e = normaliseEagerness(eagerness);
  if (e === 0) {
    return ALWAYS_ASK_BAR;
  }
  return round2(LEAST_EAGER_BAR - (e - 1) * EAGERNESS_STEP);
}

/**
 * The dial as a number this module will act on: an integer 0–10, or the
 * default when the workspace authored nothing usable.
 * @param eagerness - Whatever was stored.
 */
export function normaliseEagerness(eagerness?: number | null): number {
  if (typeof eagerness !== 'number' || !Number.isFinite(eagerness)) {
    return DEFAULT_LEARNING_EAGERNESS;
  }
  const rounded = Math.round(eagerness);
  if (rounded < MIN_LEARNING_EAGERNESS || rounded > MAX_LEARNING_EAGERNESS) {
    return DEFAULT_LEARNING_EAGERNESS;
  }
  return rounded;
}

/**
 * One clause for the run's reason line: "eagerness 7/10 → bar 72%".
 * @param eagerness - As stored.
 */
export function eagernessReason(eagerness?: number | null): string {
  const e = normaliseEagerness(eagerness);
  const bar = selfImprovementBar(e);
  return e === 0
    ? 'learning eagerness 0/10 — this workspace always asks before it learns'
    : `learning eagerness ${e}/10 → bar ${Math.round(bar * 100)}%`;
}

/**
 * Two decimal places, so 0.72 is 0.72 and not 0.7200000000000001.
 * @param n
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
