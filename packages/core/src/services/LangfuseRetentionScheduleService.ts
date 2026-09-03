/**
 * LangfuseRetentionScheduleService — keeps the daily Temporal Schedule
 * that prunes expired Langfuse traces in step with the environment.
 *
 * The schedule exists whenever a retention period does — which is by
 * default, since `LANGFUSE_RETENTION_DAYS` defaults to a year — and is
 * removed when someone sets it to 0, so turning retention off actually
 * stops the job rather than leaving a schedule that fires into a no-op
 * forever.
 * Called from the Temporal worker on start, which makes it self-healing:
 * a rebuilt Temporal cluster gets its schedule back on the next boot.
 */

import type { ScheduleOptions } from '@temporalio/client';
import { langfuseConfig } from '@/libs/Langfuse';
import {
  getTemporalClient,
  LANGFUSE_RETENTION_SCHEDULE_ID,
  LANGFUSE_RETENTION_WORKFLOW,
  VOCION_WORKFLOWS_TASK_QUEUE,
} from '@/libs/temporal/client';

/**
 * Log through a dynamic import.
 *
 * `libs/Logger` has a top-level await, and this module sits in the
 * import chain of the Temporal worker, which tsx compiles as CommonJS —
 * where a top-level await is fatal. Importing the logger normally stops
 * the worker from starting at all, which is the one process that runs
 * this job. Same approach as `libs/Langfuse.ts` and
 * `libs/retrieval/embedder.ts`.
 * @param level - Which logger method to call.
 * @param message - What happened, in plain words.
 * @param properties - Identifiers and context worth keeping.
 */
function log(
  level: 'info' | 'warn',
  message: string,
  properties: Record<string, unknown> = {},
): void {
  import('@/libs/Logger')
    .then(({ logger }) => logger[level](message, properties))
    // Nothing useful left to do if logging itself is broken.
    .catch(() => {});
}

/**
 * 03:20 UTC daily — after the 07:00 UTC EBS snapshot window would be
 * wrong (the snapshot should capture the pruned state, not race it),
 * and the small hours keep the ClickHouse delete away from working
 * hours in US time zones.
 */
const RETENTION_CRON = '20 3 * * *';

/** Build the Schedule options. Pure, so it is unit-testable without a client. */
export function buildLangfuseRetentionScheduleOptions(): ScheduleOptions {
  return {
    scheduleId: LANGFUSE_RETENTION_SCHEDULE_ID,
    spec: { cronExpressions: [RETENTION_CRON] },
    action: {
      type: 'startWorkflow',
      workflowType: LANGFUSE_RETENTION_WORKFLOW,
      taskQueue: VOCION_WORKFLOWS_TASK_QUEUE,
      args: [],
    },
  };
}

/**
 * Create, update or remove the retention Schedule to match the current
 * configuration. Idempotent — safe on every worker start.
 */
export async function applyLangfuseRetentionSchedule(): Promise<void> {
  const config = langfuseConfig();
  const wanted = config.enabled && config.retentionDays !== null;

  if (!wanted) {
    await removeSchedule();
    return;
  }

  const options = buildLangfuseRetentionScheduleOptions();
  const client = await getTemporalClient();
  try {
    await client.schedule.create(options);
    log('info', 'Langfuse retention schedule created', {
      cron: RETENTION_CRON,
      retentionDays: config.enabled ? config.retentionDays : null,
    });
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
    await client.schedule.getHandle(LANGFUSE_RETENTION_SCHEDULE_ID).delete();
    log('info', 'Langfuse retention schedule removed: retention is turned off (LANGFUSE_RETENTION_DAYS=0)');
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
