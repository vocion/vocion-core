/**
 * factory.approve_plan — approve an architecture plan, on the trust bar.
 *
 * Backlog 038. A plan the factory asked for (the plan rule required one, or
 * the worker refused a contract that carried none) used to wait for a person
 * to find it and press Build on a card that approved it as a side effect. Now
 * the plan's approval is its own decision with its own trust key: above the
 * bar it executes with Undo, below it it is one card with a recommendation,
 * and either way the approval raises `plan.approved`, which dispatches the
 * build with the plan's id (`services/factory/carry.ts`). Nobody presses
 * Build a second time.
 *
 * How sure the factory is comes from the plan itself (`planConfidence`): a
 * plan that answers what a plan must answer, for work the rule did not flag
 * as irreversible, is one a person would approve; anything else is theirs.
 */

import type { Action, ReviewCard } from './types';
import { z } from 'zod';
import { factoryTypes } from '@/libs/factory/types';
import { planIsApproved, readRecord, writeMeta } from './factory-dispatch';

export const APPROVE_PLAN_ACTION_ID = 'factory.approve_plan';

const approvePlanInput = z.object({
  /** The architecture_plan record. */
  planId: z.coerce.number().int().positive(),
  /** Why now, in a sentence a person can check. */
  reason: z.string().min(1).max(500).optional().default('The plan the build needs is written.'),
});

type Meta = Record<string, unknown>;
const str = (m: Meta, k: string): string | null => (typeof m[k] === 'string' && (m[k] as string).trim() !== '' ? (m[k] as string).trim() : null);
const list = (m: Meta, k: string): string[] => (Array.isArray(m[k]) ? (m[k] as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);

/**
 * How sure the factory is that a person would approve this plan as written:
 * it states the approach, what was rejected, how it will be verified and what
 * happens to existing data, and none of the rule's triggers is a risk class
 * that cannot be undone by reverting a commit. Pure.
 * @param meta - The plan's metadata.
 * @returns A confidence, and what holds it back when it is low.
 */
export function planConfidence(meta: Meta): { confidence: number; gaps: string[] } {
  const gaps: string[] = [];
  if (!str(meta, 'approach')) {
    gaps.push('no approach');
  }
  if (list(meta, 'components').length === 0) {
    gaps.push('no components, so no paths');
  }
  if (list(meta, 'alternatives').length === 0) {
    gaps.push('nothing considered and rejected');
  }
  if (!str(meta, 'verification')) {
    gaps.push('no verification');
  }
  if (!str(meta, 'dataImpact')) {
    gaps.push('nothing said about existing data');
  }
  const irreversible = list(meta, 'ruleTriggers').some(t => /risk class is (?:auth|billing|schema|infra|promise)/.test(t));
  if (irreversible) {
    gaps.push('the rule named a risk class a revert cannot undo');
  }
  return { confidence: gaps.length === 0 ? 0.9 : 0.6, gaps };
}

export const factoryApprovePlanAction: Action<typeof approvePlanInput> = {
  id: APPROVE_PLAN_ACTION_ID,
  name: 'Approve the plan',
  description: 'Approve an architecture_plan so the build it was written for can start. Above the workspace\'s trust bar it runs on its own with Undo; below it, a person decides on a card. Approving dispatches the build with the plan id (the contract takes its paths from the plan\'s components). Undo puts the plan back in review; a build it started has its own Undo while no worker has claimed it.',
  inputSchema: approvePlanInput,
  grant: 'factory_write',
  external: false,
  dedupKeyFor: input => `${APPROVE_PLAN_ACTION_ID}:${input.planId}`,
  async precheck(ctx, input) {
    // ONE STEP EACH (backlog 038, mission 6017): a planning run proposed an
    // approval for a plan it had never filed. The planner files the plan; its
    // approval is proposed by the factory, in code, once the plan exists.
    if (String(ctx.invokedBy ?? '').startsWith('agent:')) {
      return 'A plan\'s approval is not yours to propose: file the plan with objects.propose_candidate and stop — the factory proposes its approval on the trust bar once the plan exists.';
    }
    const planType = (await factoryTypes(ctx.orgId)).plan;
    const plan = await readRecord(ctx.orgId, input.planId);
    if (!plan || plan.typeSlug !== planType) {
      return `No architecture plan #${input.planId} in this workspace.`;
    }
    if (plan.meta.status === 'rejected' || plan.meta.status === 'superseded') {
      return `Plan #${plan.id} is ${String(plan.meta.status)}; a new plan is written instead of approving this one.`;
    }
    return undefined;
  },
  async reviewCard(ctx, input): Promise<ReviewCard> {
    const plan = await readRecord(ctx.orgId, input.planId);
    const m = plan?.meta ?? {};
    const { gaps } = planConfidence(m);
    return {
      title: `Approve the plan: ${plan?.title ?? `plan #${input.planId}`}`,
      system: 'Factory',
      summary: input.reason,
      fields: [
        ...(m.requestId ? [{ label: 'Request', value: `#${String(m.requestId)}`, href: `/dashboard/p/feature/${String(m.requestId)}` }] : []),
        { label: 'Approach', value: str(m, 'approach') ?? 'not stated' },
        { label: 'Changes', value: list(m, 'components').join('\n') || 'not stated' },
        { label: 'Why a plan', value: list(m, 'ruleTriggers').join('; ') || 'not recorded' },
        { label: 'Risks', value: list(m, 'risks').join('\n') || 'none named' },
        { label: 'Verified by', value: str(m, 'verification') ?? 'not stated' },
        ...(gaps.length > 0 ? [{ label: 'Missing', value: gaps.join('; ') }] : []),
      ],
      nextAction: 'Approving starts the build with this plan, on its own. Undo puts the plan back in review.',
      verbs: { approve: 'Approve plan', reject: 'Send back' },
    };
  },
  async execute(ctx, input) {
    const plan = await readRecord(ctx.orgId, input.planId);
    if (!plan || plan.typeSlug !== (await factoryTypes(ctx.orgId)).plan) {
      throw new Error(`No architecture plan #${input.planId}.`);
    }
    const previous = { status: plan.meta.status ?? null, approvedBy: plan.meta.approvedBy ?? null, approvedAt: plan.meta.approvedAt ?? null };
    const approvedBy = ctx.reviewedBy ?? 'the trust bar (factory.approve_plan)';
    const approvedAt = new Date().toISOString();
    if (!planIsApproved(plan.meta)) {
      await writeMeta(ctx.orgId, plan.id, { status: 'approved', approvedBy, approvedAt });
    }
    const requestId = Number(plan.meta.requestId);
    const { PLAN_APPROVED, emitEvent } = await import('@/services/EventService');
    await emitEvent({
      orgId: ctx.orgId,
      type: PLAN_APPROVED,
      payload: { planId: plan.id, requestId: Number.isInteger(requestId) && requestId > 0 ? requestId : null, approvedBy, byPerson: Boolean(ctx.reviewedBy) },
      dedupeKey: `${PLAN_APPROVED}:${plan.id}:${approvedAt}`,
      invokedBy: ctx.reviewedBy ?? 'agent:product-manager',
      dispatchMode: 'auto',
    }).catch(err => console.warn('[factory] could not raise plan.approved', { planId: plan.id, error: (err as Error).message }));
    return { planId: plan.id, requestId: Number.isInteger(requestId) && requestId > 0 ? requestId : null, approvedBy, approvedAt, previous };
  },
  async undo(ctx, _input, result) {
    const p = (result.previous ?? {}) as Meta;
    await writeMeta(ctx.orgId, Number(result.planId), { status: p.status ?? 'in_review', approvedBy: p.approvedBy ?? null, approvedAt: p.approvedAt ?? null });
    return { planId: result.planId, restoredTo: p.status ?? 'in_review' };
  },
};
