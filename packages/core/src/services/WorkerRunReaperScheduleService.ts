import type { ScheduleOptions } from '@temporalio/client';
import {
  getTemporalClient,
  VOCION_WORKFLOWS_TASK_QUEUE,
  WORKER_RUN_REAPER_SCHEDULE_ID,
  WORKER_RUN_REAPER_WORKFLOW,
} from '@/libs/temporal/client';
import { externalWorkersEnabled } from '@/services/WorkerRunService';

/**
 * The reaper's Temporal Schedule (ADR 0004). A worker run whose lease lapses
 * without a heartbeat is a process that died, hung, or lost the network; this
 * sweep marks it `lost` so a human sees it and a worker may re-claim it.
 * Deployment-wide like Langfuse retention, not per org — and, like it,
 * re-applied on every worker boot so a rebuilt Temporal gets it back.
 *
 * `libs/Logger` has a top-level await that is fatal in the tsx worker, hence
 * the dynamic import.
 */

function log(level: 'info' | 'warn', message: string, properties: Record<string, unknown> = {}): void {
  import('@/libs/Logger')
    .then(({ logger }) => logger[level](message, properties))
    .catch(() => {});
}

/** Every five minutes — a lease is 300s by default, so a lost run is noticed within two leases. */
const REAPER_CRON = '*/5 * * * *';

/** Build the Schedule options. Pure, so it is unit-testable without a client. */
export function buildWorkerRunReaperScheduleOptions(): ScheduleOptions {
  return {
    scheduleId: WORKER_RUN_REAPER_SCHEDULE_ID,
    spec: { cronExpressions: [REAPER_CRON] },
    action: {
      type: 'startWorkflow',
      workflowType: WORKER_RUN_REAPER_WORKFLOW,
      taskQueue: VOCION_WORKFLOWS_TASK_QUEUE,
      args: [],
    },
  };
}

/**
 * Create, update or remove the reaper Schedule to match the feature flag.
 * Idempotent — safe on every worker start.
 */
export async function applyWorkerRunReaperSchedule(): Promise<void> {
  if (!externalWorkersEnabled()) {
    await removeSchedule();
    return;
  }
  const options = buildWorkerRunReaperScheduleOptions();
  const client = await getTemporalClient();
  try {
    await client.schedule.create(options);
    log('info', 'worker-run reaper schedule created', { cron: REAPER_CRON });
  } catch (error) {
    if (!isAlreadyExists(error)) {
      throw error;
    }
    const handle = client.schedule.getHandle(options.scheduleId);
    await handle.update(previous => ({ ...previous, spec: options.spec, action: options.action }));
  }
}

async function removeSchedule(): Promise<void> {
  const client = await getTemporalClient();
  try {
    await client.schedule.getHandle(WORKER_RUN_REAPER_SCHEDULE_ID).delete();
    log('info', 'worker-run reaper schedule removed: external workers are disabled');
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
}

function isAlreadyExists(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? '';
  const message = (error as { message?: string })?.message ?? '';
  return name === 'ScheduleAlreadyRunning' || /already exists|already running/i.test(message);
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? '';
  const message = (error as { message?: string })?.message ?? '';
  return name === 'ScheduleNotFoundError' || /not found/i.test(message);
}
