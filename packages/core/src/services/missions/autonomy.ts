/**
 * Mission autonomy ladder. Autonomy is a property of the mission + action,
 * not the agent. A task is gated (needs human approval) when its action
 * class isn't permitted at the mission's level.
 *
 * The gate rule itself lives in the general authorization model
 * (`@/services/authz`); this module is the mission-task-shaped wrapper.
 */

import { requiresApprovalForMutation } from '@/services/authz';

export type AutonomyLevel = 1 | 2 | 3 | 4 | 5;

export const AUTONOMY_LABELS: Record<AutonomyLevel, string> = {
  1: 'Draft only',
  2: 'Ask before action',
  3: 'Act within rules',
  4: 'Manage a goal',
  5: 'Improve itself',
};

/** Task types that produce external side-effects (vs. internal analysis/drafting). */
const EXTERNAL_TYPES = new Set(['action']);

/**
 * Decide whether a task needs human approval before it runs, given the
 * mission's autonomy level and any explicit per-task flag.
 *
 * - Level 1 (draft only): every external action is gated; analysis/drafting runs.
 * - Level 2 (ask before action): external actions gated.
 * - Level 3+ (act within rules / manage goal / improve self): external actions
 *   allowed unless the task explicitly flags `approvalRequired`.
 * Internal work (analysis, creative, synthesis, artifact, diagnostic) is never
 * auto-gated — it produces drafts, not side-effects.
 * @param task
 * @param task.type
 * @param task.approvalRequired
 * @param level
 */
export function taskNeedsApproval(
  task: { type: string; approvalRequired?: boolean },
  level: AutonomyLevel,
): boolean {
  // Delegate to the single gate rule in the authorization model.
  return requiresApprovalForMutation(level, {
    external: EXTERNAL_TYPES.has(task.type),
    approvalRequired: task.approvalRequired,
  });
}

export function clampAutonomyLevel(n: number | undefined): AutonomyLevel {
  if (!n || n < 1) {
    return 1;
  }
  if (n > 5) {
    return 5;
  }
  return Math.round(n) as AutonomyLevel;
}
