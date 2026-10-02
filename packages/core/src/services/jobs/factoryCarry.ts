/**
 * The software factory carrying a request through (backlog 038), as jobs a
 * plugin automation schedules: plain code on a typed event, never an agent
 * choosing to press a button. The policy is `services/factory/recovery.ts`;
 * the reads and writes are `services/factory/carry.ts`.
 *
 * Every body is imported on first use: the durable executor loads this
 * registry, and nothing here may pull the logger's top-level await into it.
 */

export const FACTORY_INTAKE_JOB = 'factory-intake';
export const FACTORY_PLAN_REVIEW_JOB = 'factory-plan-review';
export const FACTORY_PLAN_BUILD_JOB = 'factory-plan-build';
export const FACTORY_RECOVER_JOB = 'factory-recover';
export const FACTORY_RECOVERY_ANSWER_JOB = 'factory-recovery-answer';
export const FACTORY_SWEEP_JOB = 'factory-sweep';
export const FACTORY_CONTRACT_CHANGED_JOB = 'factory-contract-changed';
export const FACTORY_PLANNING_ENDED_JOB = 'factory-planning-ended';
export const FACTORY_CI_FAILED_JOB = 'factory-ci-failed';
export const FACTORY_RECONCILE_JOB = 'factory-reconcile';
export const FACTORY_PIPELINE_FIX_ENDED_JOB = 'factory-pipeline-fix-ended';
export const FACTORY_ENVIRONMENT_DEPLOYED_JOB = 'factory-environment-deployed';
export const FACTORY_ENVIRONMENT_HEALTH_JOB = 'factory-environment-health';

type Job = (orgId: string, input: Record<string, unknown>) => Promise<unknown>;

export const factoryCarryJobs: Record<string, Job> = {
  /**
   * `pr.checks_completed` (not success) on a factory pull request: build the attempt again with what failed.
   * @param orgId
   * @param input
   */
  [FACTORY_CI_FAILED_JOB]: async (orgId, input) => (await import('@/services/factory/ciFailed')).ciFailed(orgId, input),
  /**
   * Every five minutes: read open factory pull requests back from GitHub and raise the events whose webhook never arrived; recheck pull requests a fixed base unblocked; start reviews that never started; ask about runs no worker picked up.
   * @param orgId
   * @param input
   */
  [FACTORY_RECONCILE_JOB]: async (orgId, input) => (await import('@/services/factory/reconcile')).reconcilePipeline(orgId, input),
  /**
   * `automation_run.completed` (the pipeline owner's fix run): a move it made is on the action rail, or the stop goes to a person once, with the reason.
   * @param orgId
   * @param input
   */
  [FACTORY_PIPELINE_FIX_ENDED_JOB]: async (orgId, input) => (await import('@/services/factory/pipelineChange')).pipelineFixEnded(orgId, input),
  /**
   * `run.succeeded` / `run.failed` on the deploy branch: every environment the run deployed takes its commit, time and URL, and its health is read.
   * @param orgId
   * @param input
   */
  [FACTORY_ENVIRONMENT_DEPLOYED_JOB]: async (orgId, input) => (await import('@/services/factory/environments')).recordDeploy(orgId, input),
  /**
   * Every ten minutes: read each environment's health check, and bring a down one back — re-run, redeploy, roll back — before asking a person once.
   * @param orgId
   * @param input
   */
  [FACTORY_ENVIRONMENT_HEALTH_JOB]: async (orgId, input) => (await import('@/services/factory/environmentHealth')).watchEnvironments(orgId, input),
  /**
   * `object.created` (request): start the fix a person asked for, or file the Build card.
   * @param orgId
   * @param input
   */
  [FACTORY_INTAKE_JOB]: async (orgId, input) => (await import('@/services/factory/carry')).intakeFiledRequest(orgId, input),
  /**
   * `object.created` (architecture_plan): the plan's approval, on the trust bar.
   * @param orgId
   * @param input
   */
  [FACTORY_PLAN_REVIEW_JOB]: async (orgId, input) => (await import('@/services/factory/carry')).reviewFiledPlan(orgId, input),
  /**
   * `plan.approved`: the build dispatches itself with the plan.
   * @param orgId
   * @param input
   */
  [FACTORY_PLAN_BUILD_JOB]: async (orgId, input) => (await import('@/services/factory/carry')).buildFromApprovedPlan(orgId, input),
  /**
   * `worker_run.failed`: classify, recover within the limit, or ask once.
   * @param orgId
   * @param input
   */
  [FACTORY_RECOVER_JOB]: async (orgId, input) => {
    const runId = Number(input.workerRunId);
    return Number.isInteger(runId) && runId > 0
      ? (await import('@/services/factory/carry')).recoverFailedRun(orgId, runId)
      : { requestId: null, did: 'no run named', line: null };
  },
  /**
   * `ask.decided` on a stop: the person's answer starts the count again.
   * @param orgId
   * @param input
   */
  [FACTORY_RECOVERY_ANSWER_JOB]: async (orgId, input) => (await import('@/services/factory/carry')).answerRecoveryAsk(orgId, input),
  /**
   * `object.updated` (request): a contract changed while its merge waited — back through the loop.
   * @param orgId
   * @param input
   */
  [FACTORY_CONTRACT_CHANGED_JOB]: async (orgId, input) => (await import('@/services/factory/carry')).reopenForContractChange(orgId, input),
  /**
   * `automation_run.completed` (plan request): the planning run ended — build from its plan, or plan again with what stopped it.
   * @param orgId
   * @param input
   */
  [FACTORY_PLANNING_ENDED_JOB]: async (orgId, input) => (await import('@/services/factory/carry')).planningRunEnded(orgId, input),
  /**
   * Scheduled: the same recovery for requests that were already stuck.
   * @param orgId
   * @param input
   */
  [FACTORY_SWEEP_JOB]: async (orgId, input) => (await import('@/services/factory/carry')).sweepStuckRequests(orgId, new Date(), typeof input.limit === 'number' ? input.limit : 10),
};
