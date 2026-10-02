/**
 * STARTING A RUNNER FOR A RUN (backlog 052). A target is only how a runner container starts; the
 * image, the claim and the contract are the same everywhere. Each kind is a small driver:
 * `start(target, run)` puts a container on the run, and a target that polls needs none.
 *
 * - `on-box` polls from the box's compose and takes what waited `RUNNER_CLAIM_AFTER`: nothing to
 *   start.
 * - `aws-fargate` is started at dispatch (push): one ECS task per run, told its run id, in the
 *   installation's own account and network. The instance's scheduled poll starts one more every
 *   minute as the fallback for a push that failed.
 * - Azure Container Apps and a custom host would be two more drivers of the same shape.
 *
 * Every start writes what it did on the run's own progress, where the Runs page reads it: which
 * target, which task, or why it could not start and who takes the run instead. Nothing is silent,
 * and a failed start never fails the dispatch, because the backup runner and the poll still build.
 */

import type { FargateTarget, RunnerTarget } from '@/libs/runners/config';
import type { WorkerRun } from '@/services/WorkerRunService';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { runnersConfig } from '@/libs/runners/config';
import { workerRunSchema } from '@/models/Schema';

export type StartResult
  = | { started: true; target: string; ref: string }
    | { started: false; target: string; reason: string };

/** The one ECS call a Fargate start makes, so a test hands in a double. */
export type RunTask = (input: Record<string, unknown>, region: string) => Promise<{ tasks?: Array<{ taskArn?: string }>; failures?: Array<{ reason?: string; detail?: string }> }>;

/**
 * The real ECS RunTask, on the app's own AWS credentials (the box's instance role, which the
 * instance's IaC lets run these task definitions and pass their roles, and nothing else).
 * @param input - The RunTask input.
 * @param region - The target's region.
 */
const ecsRunTask: RunTask = async (input, region) => {
  const { ECSClient, RunTaskCommand } = await import('@aws-sdk/client-ecs');
  const client = new ECSClient({ region });
  return client.send(new RunTaskCommand(input as never), { abortSignal: AbortSignal.timeout(10_000) });
};

/**
 * Whether a run's contract asks for a database beside the runner, so the target's database task
 * definition carries one.
 * @param run - The run.
 */
function wantsDatabase(run: Pick<WorkerRun, 'input'>): boolean {
  const task = ((run.input ?? {}) as Record<string, unknown>).task as Record<string, unknown> | undefined;
  const services = ((task?.environment ?? {}) as Record<string, unknown>).services;
  return Array.isArray(services) && services.some(s => (typeof s === 'string' ? s : (s as { name?: unknown })?.name) === 'postgres');
}

/**
 * The RunTask input for one run on one Fargate target: names from the installation's config, the
 * run id and the target name as the container's environment, nothing secret.
 * @param target - The Fargate target.
 * @param run - The run to start a runner for.
 */
export function fargateRunTaskInput(target: FargateTarget, run: Pick<WorkerRun, 'id' | 'input'>): Record<string, unknown> {
  return {
    cluster: target.cluster,
    taskDefinition: wantsDatabase(run) && target.taskDefinitionWithDb ? target.taskDefinitionWithDb : target.taskDefinition,
    count: 1,
    ...(target.capacityProvider ? { capacityProviderStrategy: [{ capacityProvider: target.capacityProvider, weight: 1 }] } : { launchType: 'FARGATE' }),
    networkConfiguration: {
      awsvpcConfiguration: { subnets: target.subnets, securityGroups: target.securityGroups, assignPublicIp: target.assignPublicIp ? 'ENABLED' : 'DISABLED' },
    },
    overrides: {
      containerOverrides: [{
        name: target.containerName,
        environment: [
          { name: 'WORKER_RUN_ID', value: String(run.id) },
          { name: 'RUNNER_TARGET', value: target.name },
          // Started for this run: claim it at once, not after a backup's wait.
          { name: 'RUNNER_CLAIM_AFTER', value: '0' },
        ],
      }],
    },
    startedBy: `vocion-run-${run.id}`.slice(0, 36),
  };
}

/**
 * Start one Fargate task for a run.
 * @param target - The target.
 * @param run - The run.
 * @param runTask - The ECS call.
 */
export async function startFargate(target: FargateTarget, run: Pick<WorkerRun, 'id' | 'input'>, runTask: RunTask = ecsRunTask): Promise<StartResult> {
  try {
    const out = await runTask(fargateRunTaskInput(target, run), target.region);
    const arn = out.tasks?.[0]?.taskArn;
    if (arn) {
      return { started: true, target: target.name, ref: arn.slice(arn.lastIndexOf('/') + 1) };
    }
    const f = out.failures?.[0];
    return { started: false, target: target.name, reason: [f?.reason, f?.detail].filter(Boolean).join(': ') || 'ECS started no task and said no reason' };
  } catch (e) {
    return { started: false, target: target.name, reason: (e as Error).message?.split('\n')[0]?.slice(0, 300) || 'the ECS call failed' };
  }
}

/**
 * Start a runner for a run on the installation's first target that is started rather than
 * polled. A no-op for an installation with only polling targets (the on-box default), and for a
 * run that is not an engineering run. What happened is written on the run's progress.
 * @param run - The run just queued.
 * @param opts - Seams for a test.
 * @param opts.targets - The installation's targets; its config when omitted.
 * @param opts.runTask - The ECS call.
 */
export async function startRunnerFor(run: Pick<WorkerRun, 'id' | 'kind' | 'input'>, opts: { targets?: readonly RunnerTarget[]; runTask?: RunTask } = {}): Promise<StartResult | null> {
  if (run.kind !== 'worker') {
    return null;
  }
  const targets = opts.targets ?? runnersConfig().targets;
  const pushed = targets.find((t): t is FargateTarget => t.kind === 'aws-fargate');
  if (!pushed) {
    return null;
  }
  const result = await startFargate(pushed, run, opts.runTask);
  const backup = targets.find(t => t.kind === 'on-box');
  const note = result.started
    ? `Started a runner on ${result.target} (task ${result.ref}); it claims the run when it boots.`
    : `Could not start a runner on ${result.target}: ${result.reason}. ${backup ? `The ${backup.name} runner takes the run once it has waited.` : 'The scheduled poll takes it.'}`;
  await db.update(workerRunSchema)
    .set({ progress: { phase: 'queued', note, start: result } })
    .where(eq(workerRunSchema.id, run.id))
    .catch((e: Error) => console.warn('[runners] could not note the start on the run', { runId: run.id, message: e.message }));
  if (!result.started) {
    console.warn('[runners] a runner did not start', { runId: run.id, target: result.target, reason: result.reason });
  }
  return result;
}
