/**
 * "Needs your decision" — the lane split, in code
 * (`docs/specs/briefing-v2.md` §2).
 *
 * > "What needs me — 661" destroys the promise of the product. … The brief
 * > should say something more like: "3 decisions need you today. 658
 * > lower-priority items are queued." Then show the three. I would strongly
 * > distinguish: Decisions requiring judgment, approvals safe to batch, and
 * > background queue. Never make the raw queue count the headline.
 *
 * The split is derived from the inbox's OWN kinds plus the alignment ledger,
 * so it is the same taxonomy `/dashboard/inbox` already uses — there is no
 * second decision model and no second decision UI. The cards the brief shows
 * ARE inbox items: `ref` and `href` point at the very row the inbox would
 * open, and the page renders them with the inbox's own components.
 *
 *   judgment    an ask of kind ruling / approval / input / recommendation —
 *               things only a person can answer — plus any proposal the
 *               person has NOT been agreeing with, or one carrying high risk
 *   batchable   a proposal whose action kind this person approves at least
 *               {@link BATCHABLE_AGREEMENT} of the time, over a sample of at
 *               least {@link BATCHABLE_MIN_SAMPLE}
 *   background  everything else: merges, gates, credentials, stopped runs,
 *               suggested rules, and proposals with no track record yet
 *
 * Pure — the caller reads the inbox and the ledger and hands both in.
 */

import type { BriefingDecision, DecisionLane, RecordRef } from './document';
import type { AlignmentScore } from '@/services/alignment/AlignmentService';
import type { InboxItem } from '@/services/InboxService';

/** Ask kinds that are judgment by definition: nobody but the accountable human can answer them. */
export const JUDGMENT_ASK_KINDS = ['ruling', 'approval', 'input', 'recommendation'] as const;

/** A proposal kind agreed with at least this often is safe to batch. */
export const BATCHABLE_AGREEMENT = 0.9;

/** …but only once there is a track record. Below this, the kind is background, not batchable. */
export const BATCHABLE_MIN_SAMPLE = 5;

/** A proposal kind agreed with less than this often wants judgment, however routine it looks. */
export const LOW_ALIGNMENT = 0.7;

/**
 * Which lane one waiting item falls in.
 * @param item - The inbox row.
 * @param alignment - `subjectKey` → score, from `scoresByKey` (30d). The key for a proposal is its action id.
 */
export function laneFor(item: InboxItem, alignment: Map<string, AlignmentScore>): DecisionLane {
  if ((JUDGMENT_ASK_KINDS as readonly string[]).includes(item.kind)) {
    return 'judgment';
  }
  if (item.kind !== 'proposal') {
    return 'background';
  }
  if (item.risk === 'high') {
    return 'judgment';
  }
  const score = item.actionId ? alignment.get(item.actionId) : undefined;
  if (!score || score.agreementRate === null || score.n < BATCHABLE_MIN_SAMPLE) {
    return 'background';
  }
  if (score.agreementRate < LOW_ALIGNMENT) {
    return 'judgment';
  }
  return score.agreementRate >= BATCHABLE_AGREEMENT ? 'batchable' : 'background';
}

/**
 * The lane counts for a whole queue.
 * @param items - Every open row.
 * @param alignment - `subjectKey` → score.
 */
export function splitLanes(items: InboxItem[], alignment: Map<string, AlignmentScore>): Record<DecisionLane, InboxItem[]> {
  const out: Record<DecisionLane, InboxItem[]> = { judgment: [], batchable: [], background: [] };
  for (const item of items) {
    out[laneFor(item, alignment)].push(item);
  }
  return out;
}

/** Risk, in points — the ranking's biggest lever after an incident. */
const RISK_POINTS: Record<string, number> = { high: 3, medium: 1, low: 0 };

/**
 * How a judgment item ranks against another. Higher sorts first:
 * an incident beats everything, then money at stake, then risk, then how long
 * it has been waiting. Deterministic, with the key as the final tie-break so
 * two identical scores never reorder between renders.
 * @param item - The row.
 * @param now - The clock.
 */
export function decisionScore(item: InboxItem, now: Date): number {
  const waitingDays = Math.max(0, (now.getTime() - item.at.getTime()) / 86_400_000);
  const money = item.amount ? Math.log10(Math.max(10, item.amount)) : 0;
  return money * 4 + (RISK_POINTS[item.risk ?? ''] ?? 0) * 3 + Math.min(waitingDays, 30) * 0.2;
}

/**
 * Rank judgment items. Incidents first, then {@link decisionScore}.
 * @param items - Judgment-lane rows.
 * @param isIncident - What counts as an incident in this workspace.
 * @param now - The clock.
 */
export function rankDecisions(items: InboxItem[], isIncident: (item: InboxItem) => boolean, now: Date): InboxItem[] {
  return [...items].sort((a, b) => {
    const ia = isIncident(a) ? 1 : 0;
    const ib = isIncident(b) ? 1 : 0;
    if (ia !== ib) {
      return ib - ia;
    }
    const d = decisionScore(b, now) - decisionScore(a, now);
    return d !== 0 ? d : a.key.localeCompare(b.key);
  });
}

/**
 * An inbox row, as a briefing card.
 *
 * `whyNow` is REQUIRED and the caller must supply one — the validator rejects
 * a card without it, because "$450K contract unsigned" is data and "$450K
 * contract unsigned while delivery has already started" is a briefing. When
 * the model supplies nothing, `fallbackWhyNow` builds one from what the row
 * itself knows rather than letting an empty card through.
 * @param item - The inbox row. It must carry a `ref` (a sheet row opens several things and is not a card).
 * @param whyNow - Why it matters now.
 * @param opts - Evidence and the incident marking.
 * @param opts.evidence - Records the recommendation rests on.
 * @param opts.incident - Whether this is the incident that licenses a 4th card.
 * @param opts.incidentReason - Said out loud by the renderer when it is.
 * @param opts.lane - Which lane it was classified into.
 */
export function toDecisionCard(
  item: InboxItem,
  whyNow: string,
  opts: { evidence?: RecordRef[]; incident?: boolean; incidentReason?: string; lane: DecisionLane },
): BriefingDecision | null {
  if (!item.ref) {
    return null;
  }
  return {
    key: item.key,
    ref: item.ref,
    href: item.href,
    kind: item.kind,
    title: item.title,
    whyNow,
    evidence: opts.evidence ?? [],
    lane: opts.lane,
    incident: opts.incident ?? false,
    ...(opts.incidentReason ? { incidentReason: opts.incidentReason } : {}),
    risk: item.risk,
    amount: item.amount ?? null,
    currency: item.currency ?? null,
    waitingSince: item.at,
  };
}

/**
 * The last-resort "why now", built from the row. Never empty, never the
 * title again — it says the one thing the row knows that the title does not:
 * how long this has been sitting, and what it is worth.
 * @param item - The inbox row.
 * @param now - The clock.
 */
export function fallbackWhyNow(item: InboxItem, now: Date): string {
  const days = Math.floor((now.getTime() - item.at.getTime()) / 86_400_000);
  const waited = days >= 1 ? `waiting ${days} ${days === 1 ? 'day' : 'days'}` : 'waiting since today';
  const risk = item.risk === 'high' ? ', flagged high risk' : '';
  return `Blocked on your decision — ${waited}${risk}.`;
}
