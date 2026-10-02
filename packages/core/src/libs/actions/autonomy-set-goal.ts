import type { Action, ActionContext } from './types';
import type { DbTransaction } from '@/libs/DbTransaction';
import type { Rung } from '@/services/autonomy/rungs';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { autonomyPolicySchema } from '@/models/Schema';
import { RUNGS } from '@/services/autonomy/rungs';
import { adminCheck } from '@/services/connect/createSourceOnLogin';

/** What a person who is not an admin is told, at proposal and at approval. */
const NOT_ADMIN = {
  refusal: 'Only a workspace admin can name the rung the factory works toward',
  lookupFailure: 'Could not check who approved this, so no goal was saved. Try again.',
};

const autonomySetGoalInput = z.object({
  actionIds: z.array(z.string().min(1)).min(1).max(10),
  /** The rung to work toward. A note beside the rung; it never moves the rung. */
  goal: z.enum(RUNGS),
});

/**
 * The autonomy service, loaded when a goal is saved rather than when the
 * registry builds: the service reads the registry to know each action, so a
 * static import here would make the two wait on each other at startup.
 */
function loadAutonomyService() {
  return import('@/services/autonomy/AutonomyService');
}

type AutonomyService = Awaited<ReturnType<typeof loadAutonomyService>>;

/**
 * Save the goal on one action's policy row, on the caller's transaction. A new
 * row is written at the rung the action already stands on (read through the
 * rule or default that governs it today), so adding the row moves nothing. An
 * existing row keeps its rung: the conflict update touches only the goal.
 * @param service - The autonomy service.
 * @param tx - The transaction every action's row is written on.
 * @param ctx - The workspace and who is naming the goal.
 * @param ctx.orgId
 * @param ctx.by
 * @param actionId - The action the goal is for.
 * @param goal - The rung to work toward.
 */
async function saveGoalOne(service: AutonomyService, tx: DbTransaction, ctx: { orgId: string; by: string }, actionId: string, goal: Rung): Promise<void> {
  const now = new Date();
  const current = await service.effectivePolicy(ctx.orgId, actionId, tx);
  await tx
    .insert(autonomyPolicySchema)
    .values({
      orgId: ctx.orgId,
      actionId,
      rung: current.rung,
      riskTier: current.riskTier,
      minConfidence: current.minConfidence,
      goalRung: goal,
      goalSetBy: ctx.by,
      goalSetAt: now,
      source: 'app',
    })
    .onConflictDoUpdate({
      target: [autonomyPolicySchema.orgId, autonomyPolicySchema.actionId],
      set: { goalRung: goal, goalSetBy: ctx.by, goalSetAt: now, updatedAt: now },
    });
}

/**
 * Every listed action's goal, saved one after another in one transaction.
 * Sequential on purpose: one transaction is one connection.
 * @param tx - The transaction every row is written on.
 * @param service - The autonomy service.
 * @param ctx - The workspace and who is naming the goal.
 * @param ctx.orgId
 * @param ctx.by
 * @param input - The actions and the goal.
 */
async function saveGoalsInTransaction(tx: DbTransaction, service: AutonomyService, ctx: { orgId: string; by: string }, input: z.infer<typeof autonomySetGoalInput>): Promise<void> {
  for (const actionId of input.actionIds) {
    await saveGoalOne(service, tx, ctx, actionId, input.goal);
  }
}

/**
 * Name the rung the factory works toward while setting up (#1028). The setup
 * conversation may ask "how hands-off do you want merging to get?" and record
 * the answer here as a goal. It never changes a rung and never reaches the
 * code that raises one: a rung is earned from the Autonomy page with evidence.
 */
export const autonomySetGoalAction: Action<typeof autonomySetGoalInput> = {
  id: 'autonomy.set_goal',
  name: 'Name an autonomy goal',
  description: 'Record the rung a person wants each listed action to work toward. The goal is shown beside the rung on the Autonomy page. It never raises trust; the rung stays where it is until the evidence earns the next one.',
  inputSchema: autonomySetGoalInput,
  grant: 'manage_workspace',
  external: false,
  dedupKeyFor: input => `autonomy.set_goal:${input.goal}:${[...input.actionIds].sort().join(',')}`,
  async precheck(ctx: ActionContext) {
    // A member never gets a card that fails at Approve. An agent or token
    // proposer has no account role; the approver is checked at execute.
    const proposer = ctx.invokedBy;
    if (proposer && !proposer.startsWith('agent:') && !proposer.startsWith('token:')) {
      return (await adminCheck(ctx.orgId, proposer, NOT_ADMIN)) ?? undefined;
    }
    return undefined;
  },
  async reviewCard(_ctx, input) {
    return {
      title: 'Name an autonomy goal',
      system: 'Autonomy',
      summary: `Work toward ${input.goal} for ${input.actionIds.join(', ')}.`,
      fields: [
        { label: 'Actions', value: input.actionIds.join(', ') },
        { label: 'Goal', value: input.goal },
      ],
      nextAction: 'Approving saves the goal beside each rung. It does not raise any rung.',
      verbs: { approve: 'Save goal', reject: 'Leave as is' },
    };
  },
  async execute(ctx: ActionContext, input) {
    const by = ctx.reviewedBy ?? ctx.invokedBy;
    const notAdmin = await adminCheck(ctx.orgId, by, NOT_ADMIN);
    if (notAdmin) {
      throw new Error(notAdmin);
    }
    const service = await loadAutonomyService();
    await db.transaction(tx => saveGoalsInTransaction(tx, service, { orgId: ctx.orgId, by: by! }, input));
    return { goal: input.goal, actionIds: input.actionIds };
  },
  async undo(ctx: ActionContext, input) {
    const by = ctx.reviewedBy ?? ctx.invokedBy;
    const notAdmin = await adminCheck(ctx.orgId, by, NOT_ADMIN);
    if (notAdmin) {
      throw new Error(notAdmin);
    }
    await db
      .update(autonomyPolicySchema)
      .set({ goalRung: null, goalSetBy: null, goalSetAt: null, updatedAt: new Date() })
      .where(and(eq(autonomyPolicySchema.orgId, ctx.orgId), inArray(autonomyPolicySchema.actionId, input.actionIds)));
  },
};
