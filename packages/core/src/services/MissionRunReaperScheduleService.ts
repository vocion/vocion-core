import type { ScheduleOptions } from '@temporalio/client';
import {
  getTemporalClient,
  MISSION_RUN_REAPER_SCHEDULE_ID,
  MISSION_RUN_REAPER_WORKFLOW,
  VOCION_WORKFLOWS_TASK_QUEUE,
} from '@/libs/temporal/client';

/**
 * The mission-run reaper's Temporal Schedule — same shape and cadence as the
 * worker-run reaper (`WorkerRunReaperScheduleService`, ADR 0004), for the
 * mission-run analogue of the bug it fixes: a mission run executes
 * in-process with no lease, so a server restart or a crashed process leaves
 * the row sitting `running` (or `planning`/`paused`/`awaiting_review`) for
 * ever. This sweep marks a run whose last activity is older than the bound
 * `failed`, so a person sees it and it stops reading as still working.
 *
 * Deployment-wide, not per org — like the worker-run reaper and Langfuse
 * retention — and re-applied on every worker boot so a rebuilt Temporal gets
 * it back. Always on: every workspace runs missions, unlike external
 * workers, so there is no feature flag to gate this behind.
 */

function log(level: 'info' | 'warn', message: string, properties: Record<string, unknown> = {}): void {
  import('@/libs/Logger')
    .then(({ logger }) => logger[level](message, properties))
    .catch(() => {});
}

/** Every five minutes — matches the worker-run reaper's cadence. */
const REAPER_CRON = '*/5 * * * *';

/** Build the Schedule options. Pure, so it is unit-testable without a client. */
export function buildMissionRunReaperScheduleOptions(): ScheduleOptions {
  return {
    scheduleId: MISSION_RUN_REAPER_SCHEDULE_ID,
    spec: { cronExpressions: [REAPER_CRON] },
    action: {
      type: 'startWorkflow',
      workflowType: MISSION_RUN_REAPER_WORKFLOW,
      taskQueue: VOCION_WORKFLOWS_TASK_QUEUE,
      args: [],
    },
  };
}

/**
 * Create or update the reaper Schedule. Idempotent — safe on every worker start.
 */
export async function applyMissionRunReaperSchedule(): Promise<void> {
  const options = buildMissionRunReaperScheduleOptions();
  const client = await getTemporalClient();
  try {
    await client.schedule.create(options);
    log('info', 'mission-run reaper schedule created', { cron: REAPER_CRON });
  } catch (error) {
    if (!isAlreadyExists(error)) {
      throw error;
    }
    const handle = client.schedule.getHandle(options.scheduleId);
    await handle.update(previous => ({ ...previous, spec: options.spec, action: options.action }));
  }
}

function isAlreadyExists(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? '';
  const message = (error as { message?: string })?.message ?? '';
  return name === 'ScheduleAlreadyRunning' || /already exists|already running/i.test(message);
}
