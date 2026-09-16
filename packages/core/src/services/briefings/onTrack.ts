/**
 * "Are we on track?" — the credibility rule, in code
 * (`docs/specs/briefing-v2.md` §3).
 *
 * > "Are we on track — On track" is not credible. The very next sentence is
 * > "Nothing ran, so nothing to judge yet." … If you cannot judge
 * > performance, don't give a green status.
 *
 * A green, amber or red verdict requires at least one measure that (a) the
 * system can actually see — provenance `verified` or `observed`, the two
 * kinds that come from a system of record or from Vocion's own tables — and
 * (b) carries a target to be judged against. Without one the answer is
 * `not-enough-evidence`, and `hasContent` then omits the section entirely
 * unless the person has set a target, in which case the brief says exactly
 * that and nothing more.
 *
 * "On track" next to "nothing ran" is impossible here by construction: there
 * is no argument to this function that produces a coloured status from
 * measures the system could not read.
 */

import type { BriefingMetric, OnTrack } from './document';
import type { ProvenanceKind } from '@/libs/workspace/schemas';

/** The provenance kinds strong enough to licence a verdict. */
export const JUDGEABLE_PROVENANCE: readonly ProvenanceKind[] = ['verified', 'observed'];

/** Within this fraction of target still reads amber rather than red. */
export const AT_RISK_ATTAINMENT = 0.8;

/**
 * Can this metric be judged at all? It must have a value, a target, and
 * provenance the system stands behind.
 * @param m - The metric.
 */
export function isJudgeable(m: BriefingMetric): boolean {
  return m.value !== null && m.target !== undefined && JUDGEABLE_PROVENANCE.includes(m.provenance);
}

/**
 * The verdict. The ONLY writer of `today.onTrack`.
 * @param metrics - This brief's metrics, post-join.
 * @param opts - Whether the person has set a target for this window at all.
 * @param opts.targetSet - True when a target exists somewhere in the workspace, even if nothing readable measures it.
 */
export function deriveOnTrack(metrics: BriefingMetric[], opts: { targetSet?: boolean } = {}): OnTrack {
  const judgeable = metrics.filter(isJudgeable);
  const targetSet = opts.targetSet ?? metrics.some(m => m.target !== undefined);

  if (judgeable.length === 0) {
    return {
      status: 'not-enough-evidence',
      basis: [],
      targetSet,
      note: targetSet
        ? 'A target is set, but nothing the system can verify has been measured against it yet.'
        : undefined,
    };
  }

  // Attainment per measure, direction-aware is the team report's job; here a
  // target is "value ≥ target" for the metrics a brief carries.
  const attainments = judgeable.map(m => (m.target === 0 ? (m.value! >= 0 ? 1 : 0) : m.value! / m.target!));
  const worst = Math.min(...attainments);
  const status = worst >= 1 ? 'on-track' : worst >= AT_RISK_ATTAINMENT ? 'at-risk' : 'off-track';

  return { status, basis: judgeable.map(m => m.key), targetSet: true };
}

/** How the verdict is spelled on a surface. */
export const ON_TRACK_LABEL = {
  'on-track': 'On track',
  'at-risk': 'At risk',
  'off-track': 'Off track',
  'not-enough-evidence': 'Not enough evidence',
} as const;
