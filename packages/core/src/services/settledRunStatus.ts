/**
 * The end states of a run, shared by mission runs and workflow runs.
 *
 * Once a run reaches one of these, nothing may write its status again: the
 * run loops guard their writes with it so a person's cancel cannot be
 * overwritten by the loop finishing (vocion-core#123). Both loops read the
 * same list so a new end state added here is respected by both.
 */
export const SETTLED_RUN_STATUSES = ['completed', 'failed', 'cancelled'] as const;

/**
 * Has the run reached an end state — most often, has a person cancelled it?
 * @param status - A `mission_run.status` or `workflow_run.status` value.
 * @returns True for completed, failed and cancelled.
 */
export function isSettledRunStatus(status: string): boolean {
  return (SETTLED_RUN_STATUSES as readonly string[]).includes(status);
}
