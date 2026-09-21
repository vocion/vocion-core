/**
 * The plans waiting on a person, as rows in Review.
 *
 * A plan in `in_review` is the one kind of thing a person should decide:
 * direction and tradeoffs, before the work starts. It is not a retry, a
 * routine release or a metadata correction, so it does not go around a person
 * under earned autonomy, and it is not routed anywhere else. It arrives here.
 *
 * This module is the half that knows the table. The wording, the gaps and the
 * decision contract are in `planApproval.ts`, which takes plain values so the
 * sentences can be tested without a seeded queue.
 *
 * The row opens at the feature report rather than at a detail screen of its
 * own, which is the answer to the question that started this: the plan is
 * reviewed WITH the feature it plans, in the same place as the ask, the
 * triage, the contract and the runs, not on a page by itself.
 */

import type { PlanApprovalInput } from './planApproval';
import type { PlanDecision, PlanLevel, PlanTrigger } from '@/services/factory/planRule';
import type { InboxItem } from '@/services/InboxService';
import { listBusinessObjects } from '@/services/BusinessObjectService';
import { PLAN_DEFAULT_THRESHOLDS } from '@/services/factory/planRule';
import { planApprovalContract, planApprovalDecision } from './planApproval';

type ObjectRow = { id: number; title: string; status: string | null; createdAt: Date | null; updatedAt?: Date | null; metadata: unknown };

/**
 * A string off free-form JSON, or null when it is absent or blank.
 * @param meta
 * @param key
 */
function str(meta: Record<string, unknown>, key: string): string | null {
  const v = meta[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * A list of strings off free-form JSON, blanks dropped.
 * @param meta
 * @param key
 */
function strings(meta: Record<string, unknown>, key: string): string[] {
  const v = meta[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
}

/**
 * A positive integer off free-form JSON, however the writer spelled it.
 * @param meta
 * @param key
 */
function intOf(meta: Record<string, unknown>, key: string): number | null {
  const v = meta[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The rule's verdict as the plan itself recorded it.
 *
 * Read off the record rather than recomputed, because the rule that mattered
 * is the one that was applied when the plan was written. Recomputing it here
 * would let a later change to the rule silently rewrite why a plan exists.
 * @param meta - The plan's metadata.
 */
function ruleFrom(meta: Record<string, unknown>): PlanDecision {
  const level = str(meta, 'ruleLevel');
  const triggers: PlanTrigger[] = strings(meta, 'ruleTriggers').map((why): PlanTrigger => ({ code: 'recorded', why }));
  return {
    level: (level === 'required' || level === 'offered' || level === 'not_required' ? level : 'not_required') as PlanLevel,
    triggers,
    offered: str(meta, 'offeredBecause'),
    unknown: [],
    thresholds: PLAN_DEFAULT_THRESHOLDS,
  };
}

/**
 * Everything `planApproval` needs about one plan, off the record alone.
 * @param row - The plan object.
 * @param requestTitle - The request's own title, or a stand-in when it cannot be read.
 * @param workAlreadyRan - Whether a worker has already run on this work.
 */
export function planApprovalInputFrom(row: ObjectRow, requestTitle: string, workAlreadyRan: boolean): PlanApprovalInput {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  return {
    planId: row.id,
    planTitle: row.title,
    approach: str(meta, 'approach'),
    alternatives: strings(meta, 'alternatives'),
    verification: str(meta, 'verification'),
    dataImpact: str(meta, 'dataImpact'),
    requestTitle,
    rule: ruleFrom(meta),
    tasksWaiting: (Array.isArray(meta.taskIds) ? meta.taskIds : []).length,
    workAlreadyRan,
  };
}

/**
 * The plans in front of a person right now, one row each.
 *
 * `catch` on the listing because a workspace on an older plugin has no
 * `architecture_plan` type at all, and a missing type is not a waiting
 * decision: it is a workspace that never adopted the gate.
 * @param orgId
 */
export async function planApprovalRows(orgId: string): Promise<InboxItem[]> {
  const rows = (await listBusinessObjects(orgId, 'architecture_plan').catch(() => [])) as ObjectRow[];
  const waiting = rows.filter(r => r.status === 'in_review');
  if (waiting.length === 0) {
    return [];
  }

  const requests = new Map<number, string>();
  const requestRows = (await listBusinessObjects(orgId, 'request').catch(() => [])) as ObjectRow[];
  for (const r of requestRows) {
    requests.set(r.id, r.title);
  }

  return waiting.map((row) => {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const requestId = intOf(meta, 'requestId');
    const requestTitle = (requestId !== null ? requests.get(requestId) : null) ?? row.title;
    const input = planApprovalInputFrom(row, requestTitle, meta.workAlreadyRan === true);
    const decision = planApprovalDecision(input);
    const contract = planApprovalContract(input);
    return {
      key: `plan:${row.id}`,
      kind: 'approval' as const,
      shape: 'single' as const,
      title: contract.decision,
      subline: [
        decision.blocking ? 'Blocking' : 'Not blocking',
        `about ${decision.minutes} min`,
        decision.gaps.length === 0 ? 'the plan answers everything it should' : `${decision.gaps.length} gap${decision.gaps.length === 1 ? '' : 's'} in the plan`,
      ].join(' › '),
      agentSlug: str(meta, 'writtenBy'),
      teamSlug: 'software-factory',
      risk: decision.blocking ? 'high' : 'medium',
      status: 'in_review',
      at: row.updatedAt ?? row.createdAt ?? new Date(),
      // The plan is reviewed with the feature it plans, not on a page of its own.
      href: requestId === null ? `/dashboard/objects/${row.id}` : `/dashboard/p/feature/${requestId}`,
      detail: decision.recommendation,
      contract,
    };
  });
}
