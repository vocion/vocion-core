import { os } from '@orpc/server';
import { z } from 'zod';
import { GOAL_LINK_KINDS, GOAL_STATUSES } from '@/libs/objectives/goal';
import { GoalError, linkGoal, setGoalMilestone, updateGoal } from '@/services/objectives/GoalService';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/**
 * The goal page's own moves (`app/.../dashboard/goals/[id]`): Pause, Done,
 * Drop and Resume; ticking a milestone by hand (which then wins over every
 * check); unlinking something. Each is the signed-in person's, on a goal they
 * own, in the workspace they are in (`services/objectives/GoalService.ts`).
 * Creating a goal is not here: it is a Decision (`goal.create`).
 */

const goalInput = z.object({ goalId: z.number().int().positive() });

/**
 * Run a goal write as the person, saying a refusal in their words.
 * @param write - The write.
 */
async function asPerson<T>(write: (who: { orgId: string; userId: string }) => Promise<T>): Promise<T> {
  const { orgId, userId } = await guardAuth();
  try {
    return await write({ orgId: orgId!, userId: userId! });
  } catch (error) {
    if (error instanceof GoalError) {
      throw ApiError.badRequest(error.message);
    }
    throw error;
  }
}

/** goals.setStatus — Pause, Done, Drop, Resume. */
export const setStatusRoute = os
  .input(goalInput.extend({ status: z.enum(GOAL_STATUSES) }))
  .handler(async ({ input }) => asPerson(async ({ orgId, userId }) => {
    const goal = await updateGoal(orgId, input.goalId, { userId, by: 'person' }, { status: input.status });
    return { id: goal.id, status: goal.status };
  }));

/** goals.setMilestone — the person's own tick or untick; it locks the step. */
export const setMilestoneRoute = os
  .input(goalInput.extend({ key: z.string().min(1).max(20), done: z.boolean() }))
  .handler(async ({ input }) => asPerson(async ({ orgId, userId }) => {
    const goal = await setGoalMilestone(orgId, input.goalId, { userId, by: 'person' }, input.key, input.done);
    return { id: goal.id, milestones: goal.measure.kind === 'milestones' ? goal.measure.milestones : [] };
  }));

/** goals.unlink — take one linked item off the goal. */
export const unlinkRoute = os
  .input(goalInput.extend({ kind: z.enum(GOAL_LINK_KINDS), id: z.string().min(1).max(120) }))
  .handler(async ({ input }) => asPerson(async ({ orgId, userId }) => {
    const goal = await linkGoal(orgId, input.goalId, { userId, by: 'person' }, { remove: [{ kind: input.kind, id: input.id }] });
    return { id: goal.id, links: goal.links };
  }));
