/**
 * The default mockup, as jobs a plugin automation schedules — plain code on a
 * typed event (`services/factory/mockupDefault.ts`). The drawing itself is the
 * plugin's designer, fired by `mockup.requested`; these only decide that one
 * is owed, and answer how it ended.
 *
 * Bodies are imported on first use: the Temporal worker loads this registry.
 */

/** `object.created` / `object.updated`: a record the rule says has a UI, with no mockup yet. */
export const MOCKUP_DEFAULT_JOB = 'mockup-default';
/** `automation_run.completed` / `.failed` of the drawing: drawn, once more, or written down. */
export const MOCKUP_ENDED_JOB = 'mockup-ended';

type Job = (orgId: string, input: Record<string, unknown>) => Promise<unknown>;

export const mockupDefaultJobs: Record<string, Job> = {
  [MOCKUP_DEFAULT_JOB]: async (orgId, input) => (await import('@/services/factory/mockupDefault')).requestDefaultMockup(orgId, input),
  [MOCKUP_ENDED_JOB]: async (orgId, input) => (await import('@/services/factory/mockupDefault')).defaultMockupEnded(orgId, input),
};
