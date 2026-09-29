/**
 * The software factory carrying a request through (backlog 038), as jobs a
 * plugin automation schedules: plain code on a typed event, never an agent
 * choosing to press a button. The policy is `services/factory/recovery.ts`;
 * the reads and writes are `services/factory/carry.ts`.
 *
 * Every body is imported on first use: the Temporal worker loads this
 * registry, and nothing here may pull the logger's top-level await into it.
 */

export const FACTORY_INTAKE_JOB = 'factory-intake';
export const FACTORY_PLAN_REVIEW_JOB = 'factory-plan-review';
export const FACTORY_PLAN_BUILD_JOB = 'factory-plan-build';
export const FACTORY_RECOVER_JOB = 'factory-recover';
export const FACTORY_RECOVERY_ANSWER_JOB = 'factory-recovery-answer';
export const FACTORY_SWEEP_JOB = 'factory-sweep';
export const FACTORY_CONTRACT_CHANGED_JOB = 'factory-contract-changed';

type Job = (orgId: string, input: Record<string, unknown>) => Promise<unknown>;

export const factoryCarryJobs: Record<string, Job> = {
  /** `object.created` (request): start the fix a person asked for, or file the Build card. */
  [FACTORY_INTAKE_JOB]: async (orgId, input) => (await import('@/services/factory/carry')).intakeFiledRequest(orgId, input),
  /** `object.created` (architecture_plan): the plan's approval, on the trust bar. */
  [FACTORY_PLAN_REVIEW_JOB]: async (orgId, input) => (await import('@/services/factory/carry')).reviewFiledPlan(orgId, input),
  /** `plan.approved`: the build dispatches itself with the plan. */
  [FACTORY_PLAN_BUILD_JOB]: async (orgId, input) => (await import('@/services/factory/carry')).buildFromApprovedPlan(orgId, input),
  /** `worker_run.failed`: classify, recover within the limit, or ask once. */
  [FACTORY_RECOVER_JOB]: async (orgId, input) => {
    const runId = Number(input.workerRunId);
    return Number.isInteger(runId) && runId > 0
      ? (await import('@/services/factory/carry')).recoverFailedRun(orgId, runId)
      : { requestId: null, did: 'no run named', line: null };
  },
  /** `ask.decided` on a stop: the person's answer starts the count again. */
  [FACTORY_RECOVERY_ANSWER_JOB]: async (orgId, input) => (await import('@/services/factory/carry')).answerRecoveryAsk(orgId, input),
  /** `object.updated` (request): a contract changed while its merge waited — back through the loop. */
  [FACTORY_CONTRACT_CHANGED_JOB]: async (orgId, input) => (await import('@/services/factory/carry')).reopenForContractChange(orgId, input),
  /** Scheduled: the same recovery for requests that were already stuck. */
  [FACTORY_SWEEP_JOB]: async (orgId, input) => (await import('@/services/factory/carry')).sweepStuckRequests(orgId, new Date(), typeof input.limit === 'number' ? input.limit : 10),
};
