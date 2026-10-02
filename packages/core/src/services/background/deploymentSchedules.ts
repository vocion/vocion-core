import type { ScheduleSpec } from '@/libs/durable/jobs';
import { scheduleJob, unscheduleJob } from '@/libs/durable/jobs';
import {
  ARTIFACT_IMAGE_SWEEP_SCHEDULE_ID,
  LANGFUSE_RETENTION_SCHEDULE_ID,
  MISSION_RUN_REAPER_SCHEDULE_ID,
  WORKER_RUN_REAPER_SCHEDULE_ID,
} from '@/libs/durable/scheduleIds';
import { langfuseConfig } from '@/libs/Langfuse';
import { externalWorkersEnabled } from '@/services/WorkerRunService';
import { JOB } from './catalog';

/**
 * THE DEPLOYMENT-WIDE SCHEDULES (v0.6.0): the jobs one installation runs on a
 * clock regardless of workspace. Applied when the durable executor starts on
 * the process that owns schedules, so a fresh database gets them back on the
 * next boot and turning a feature off removes its job rather than leaving it
 * firing into a no-op.
 *
 *   - Mission-run reaper, every five minutes: a mission run executes
 *     in-process with no lease, so a dead process leaves its row `running`.
 *   - Worker-run reaper, every five minutes, only with external workers on
 *     (ADR 0004): a lease that lapsed without a heartbeat is a lost run.
 *   - Artifact image sweep, hourly at :17: retries an image whose copy into
 *     the store failed while its presigned link is still valid.
 *   - Langfuse retention, 03:20 UTC daily, only while a retention period is
 *     set: prunes expired traces outside working hours in US time zones.
 *   - Durable prune, 04:10 UTC daily: deletes finished job runs older than a
 *     week so the durable tables do not grow with every tick.
 */

export const DURABLE_PRUNE_SCHEDULE_ID = 'durable-prune';

/** Every schedule this deployment should have, and those it should not. Pure. */
export function deploymentSchedules(): { wanted: ScheduleSpec[]; unwanted: string[] } {
  const wanted: ScheduleSpec[] = [
    { name: MISSION_RUN_REAPER_SCHEDULE_ID, cron: '*/5 * * * *', job: JOB.missionRunReaper },
    { name: ARTIFACT_IMAGE_SWEEP_SCHEDULE_ID, cron: '17 * * * *', job: JOB.artifactImageSweep },
    { name: DURABLE_PRUNE_SCHEDULE_ID, cron: '10 4 * * *', job: JOB.durablePrune },
  ];
  const unwanted: string[] = [];
  if (externalWorkersEnabled()) {
    wanted.push({ name: WORKER_RUN_REAPER_SCHEDULE_ID, cron: '*/5 * * * *', job: JOB.workerRunReaper });
  } else {
    unwanted.push(WORKER_RUN_REAPER_SCHEDULE_ID);
  }
  const langfuse = langfuseConfig();
  if (langfuse.enabled && langfuse.retentionDays !== null) {
    wanted.push({ name: LANGFUSE_RETENTION_SCHEDULE_ID, cron: '20 3 * * *', job: JOB.langfuseRetention });
  } else {
    unwanted.push(LANGFUSE_RETENTION_SCHEDULE_ID);
  }
  return { wanted, unwanted };
}

/**
 * Create, update or remove each deployment schedule. Idempotent; one failing
 * schedule is logged and the rest still apply.
 */
export async function applyDeploymentSchedules(): Promise<{ applied: string[]; removed: string[]; failed: string[] }> {
  const { wanted, unwanted } = deploymentSchedules();
  const out = { applied: [] as string[], removed: [] as string[], failed: [] as string[] };
  for (const spec of wanted) {
    try {
      await scheduleJob(spec);
      out.applied.push(spec.name);
    } catch (err) {
      out.failed.push(spec.name);
      console.error(`[durable] could not apply the "${spec.name}" schedule`, err);
    }
  }
  for (const name of unwanted) {
    try {
      await unscheduleJob(name);
      out.removed.push(name);
    } catch (err) {
      out.failed.push(name);
      console.error(`[durable] could not remove the "${name}" schedule`, err);
    }
  }
  return out;
}
