/**
 * The live check's end, as a job a plugin automation schedules — plain code
 * on a typed event (`services/factory/liveCheck.ts` `liveCheckEnded`). The
 * check itself is the plugin's QA, fired by `release.linked` and
 * `release.live_check.requested`; this only answers how a fire ended.
 *
 * Bodies are imported on first use: the durable executor loads this registry.
 */

/** `automation_run.completed` / `.failed` of the live check: seen, once more, or written down. */
export const LIVE_CHECK_ENDED_JOB = 'live-check-ended';

type Job = (orgId: string, input: Record<string, unknown>) => Promise<unknown>;

export const liveCheckJobs: Record<string, Job> = {
  [LIVE_CHECK_ENDED_JOB]: async (orgId, input) => (await import('@/services/factory/liveCheck')).liveCheckEnded(orgId, input),
};
