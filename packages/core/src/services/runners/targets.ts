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
 *
 * A pushed task carries no long-lived Vocion secret (Vocion 5.1): its only Vocion credential is a
 * start token (`runToken.ts`) that claims this one run and nothing else, and the claim trades it
 * for the run's own token. Repository code in that container can reach no other run.
 *
 * Where a workspace (or its account) names the target that serves it (`workspaceTarget.ts`), the
 * push goes there and nowhere else: a polled target starts nothing, and an undeclared one is said
 * on the run.
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
import { signStartToken } from '@/services/runners/runToken';
import { runnerTargetFor } from '@/services/runners/workspaceTarget';

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
 * The RunTask input for one run on one Fargate target: names from the installation's config, and
 * as the container's environment the run id, the target name and a start token for this run.
 * The start token is the only credential in the overrides, and it claims only this run; no
 * installation or account runner token is ever put here.
 * @param target - The Fargate target.
 * @param run - The run to start a runner for.
 */
export function fargateRunTaskInput(target: FargateTarget, run: Pick<WorkerRun, 'id' | 'orgId' | 'input'>): Record<string, unknown> {
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
          // The one credential: claims this run, as this target, once.
          { name: 'VOCION_RUN_TOKEN', value: signStartToken({ orgId: run.orgId, runId: run.id, target: target.name }) },
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
export async function startFargate(target: FargateTarget, run: Pick<WorkerRun, 'id' | 'orgId' | 'input'>, runTask: RunTask = ecsRunTask): Promise<StartResult> {
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
 * Write what a start did, or why there was none, on the run's progress, where the Runs page reads
 * it. Never throws: a note that cannot be written is logged.
 * @param runId - The run.
 * @param note - The sentence.
 * @param start - The start result.
 */
async function noteStart(runId: number, note: string, start: StartResult): Promise<void> {
  await db.update(workerRunSchema)
    .set({ progress: { phase: 'queued', note, start } })
    .where(eq(workerRunSchema.id, runId))
    .catch((e: Error) => console.warn('[runners] could not note the start on the run', { runId, message: e.message }));
}

/**
 * Start a runner for a run. Where the run's workspace (or account) names its target, on that
 * target only; otherwise on the installation's first target that is started rather than polled.
 * A no-op where the target that serves the run polls (the on-box default), and for a run that is
 * not an engineering run. What happened is written on the run's progress.
 * @param run - The run just queued.
 * @param opts - Seams for a test.
 * @param opts.targets - The installation's targets; its config when omitted.
 * @param opts.runTask - The ECS call.
 */
export async function startRunnerFor(run: Pick<WorkerRun, 'id' | 'orgId' | 'kind' | 'input'>, opts: { targets?: readonly RunnerTarget[]; runTask?: RunTask } = {}): Promise<StartResult | null> {
  if (run.kind !== 'worker') {
    return null;
  }
  const targets = opts.targets ?? runnersConfig().targets;
  const servedBy = (await runnerTargetFor(run.orgId)).target;
  let pushed: FargateTarget | undefined;
  if (servedBy) {
    const named = targets.find(t => t.name === servedBy);
    if (!named) {
      const result: StartResult = { started: false, target: servedBy, reason: `"${servedBy}" is not a runner target this installation declares` };
      await noteStart(run.id, `This workspace's runs are built on "${servedBy}", which this installation does not declare (VOCION_RUNNERS). No runner will take the run until the workspace names a declared target.`, result);
      console.warn('[runners] a workspace names an undeclared target', { runId: run.id, target: servedBy });
      return result;
    }
    if (named.kind !== 'aws-fargate') {
      return null;
    }
    pushed = named;
  } else {
    pushed = targets.find((t): t is FargateTarget => t.kind === 'aws-fargate');
    if (!pushed) {
      return null;
    }
  }
  const result = await startFargate(pushed, run, opts.runTask);
  // A workspace that names its target has no backup elsewhere: only that target may build it.
  const backup = servedBy ? undefined : targets.find(t => t.kind === 'on-box');
  const note = result.started
    ? `Started a runner on ${result.target} (task ${result.ref}); it claims the run when it boots.`
    : `Could not start a runner on ${result.target}: ${result.reason}. ${backup ? `The ${backup.name} runner takes the run once it has waited.` : 'The scheduled poll takes it.'}`;
  await noteStart(run.id, note, result);
  if (!result.started) {
    console.warn('[runners] a runner did not start', { runId: run.id, target: result.target, reason: result.reason });
  }
  return result;
}
