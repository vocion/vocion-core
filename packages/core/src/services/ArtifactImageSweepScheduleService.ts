import type { ScheduleOptions } from '@temporalio/client';
import {
  ARTIFACT_IMAGE_SWEEP_SCHEDULE_ID,
  ARTIFACT_IMAGE_SWEEP_WORKFLOW,
  getTemporalClient,
  VOCION_WORKFLOWS_TASK_QUEUE,
} from '@/libs/temporal/client';

/**
 * The artifact image sweep's Temporal Schedule. An image artifact whose copy
 * into the artifact store failed for a reason that may not hold later (a
 * timeout, a 5xx) keeps its external link and says why; this retries it
 * hourly while the link is still valid (`services/artifacts/imageIngest.ts`).
 * A presigned link lasts at most seven days, so an hourly retry has well over
 * a hundred chances before the evidence is gone.
 *
 * Deployment-wide, always on, re-applied on every worker boot — the same
 * shape as the reapers.
 */

function log(level: 'info' | 'warn', message: string, properties: Record<string, unknown> = {}): void {
  import('@/libs/Logger')
    .then(({ logger }) => logger[level](message, properties))
    .catch(() => {});
}

/** Hourly, at a minute nothing else fires on. */
const SWEEP_CRON = '17 * * * *';

/** Build the Schedule options. Pure, so it is unit-testable without a client. */
export function buildArtifactImageSweepScheduleOptions(): ScheduleOptions {
  return {
    scheduleId: ARTIFACT_IMAGE_SWEEP_SCHEDULE_ID,
    spec: { cronExpressions: [SWEEP_CRON] },
    action: {
      type: 'startWorkflow',
      workflowType: ARTIFACT_IMAGE_SWEEP_WORKFLOW,
      taskQueue: VOCION_WORKFLOWS_TASK_QUEUE,
      args: [],
    },
  };
}

/** Create or update the Schedule. Idempotent — safe on every worker start. */
export async function applyArtifactImageSweepSchedule(): Promise<void> {
  const options = buildArtifactImageSweepScheduleOptions();
  const client = await getTemporalClient();
  try {
    await client.schedule.create(options);
    log('info', 'artifact image sweep schedule created', { cron: SWEEP_CRON });
  } catch (error) {
    const name = (error as { name?: string })?.name ?? '';
    const message = (error as { message?: string })?.message ?? '';
    if (name !== 'ScheduleAlreadyRunning' && !/already exists|already running/i.test(message)) {
      throw error;
    }
    const handle = client.schedule.getHandle(options.scheduleId);
    await handle.update(previous => ({ ...previous, spec: options.spec, action: options.action }));
  }
}
