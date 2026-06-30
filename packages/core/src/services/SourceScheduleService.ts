/**
 * SourceScheduleService — turns a source's `schedule` cron into a live
 * Temporal Schedule that fires `sourceSyncWorkflow` (→ `syncSourceActivity`
 * → `runSync`) on that cadence.
 *
 * Sources declare a cron in their manifest (`sources/<slug>.yaml`); until now
 * nothing acted on it — syncs were manual-only. This ensures one Schedule per
 * scheduled source, idempotently, so the reference deployments run themselves.
 *
 * The options builder is pure (and unit-tested); `ensureSourceSchedule` /
 * `removeSourceSchedule` talk to a running Temporal and are exercised in the
 * platform integration suite.
 */

import type { ScheduleOptions } from '@temporalio/client';
import {
  getTemporalClient,
  SOURCE_SYNC_WORKFLOW,
  sourceScheduleIdFor,
  VOCION_WORKFLOWS_TASK_QUEUE,
} from '@/libs/temporal/client';

export type SourceScheduleSpec = {
  orgId: string;
  sourceId: number;
  sourceSlug: string;
  /** Cron expression from the source manifest, e.g. `0 6 * * *`. */
  cron: string;
};

/**
 * Build the Temporal `ScheduleOptions` for a source's recurring incremental
 * sync. Pure — no client, no I/O — so it's unit-testable.
 * @param spec
 */
export function buildSourceScheduleOptions(spec: SourceScheduleSpec): ScheduleOptions {
  return {
    scheduleId: sourceScheduleIdFor(spec.orgId, spec.sourceSlug),
    spec: { cronExpressions: [spec.cron] },
    action: {
      type: 'startWorkflow',
      workflowType: SOURCE_SYNC_WORKFLOW,
      taskQueue: VOCION_WORKFLOWS_TASK_QUEUE,
      args: [{ orgId: spec.orgId, sourceId: spec.sourceId, incremental: true }],
    },
  };
}

/**
 * Create (or update) the source's sync Schedule. Idempotent — if the Schedule
 * already exists, its spec + action are updated in place.
 * @param spec
 */
export async function ensureSourceSchedule(spec: SourceScheduleSpec): Promise<void> {
  const client = await getTemporalClient();
  const options = buildSourceScheduleOptions(spec);
  try {
    await client.schedule.create(options);
  } catch (err) {
    // Already exists → update the spec + action in place.
    if (isAlreadyExists(err)) {
      const handle = client.schedule.getHandle(options.scheduleId);
      await handle.update(prev => ({ ...prev, spec: options.spec, action: options.action }));
      return;
    }
    throw err;
  }
}

/**
 * Delete a source's sync Schedule. No-op if it doesn't exist.
 * @param orgId
 * @param sourceSlug
 */
export async function removeSourceSchedule(orgId: string, sourceSlug: string): Promise<void> {
  const client = await getTemporalClient();
  try {
    await client.schedule.getHandle(sourceScheduleIdFor(orgId, sourceSlug)).delete();
  } catch (err) {
    if (!isNotFound(err)) {
      throw err;
    }
  }
}

function isAlreadyExists(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? '';
  const message = (err as { message?: string })?.message ?? '';
  return name === 'ScheduleAlreadyRunning' || /already exists|already running/i.test(message);
}

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? '';
  const message = (err as { message?: string })?.message ?? '';
  return name === 'ScheduleNotFoundError' || /not found/i.test(message);
}
