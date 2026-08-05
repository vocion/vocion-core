/**
 * SourceScheduleService — turns a source's `schedule` cron into a live
 * Temporal Schedule that fires `sourceSyncWorkflow` (→ `syncSourceActivity`
 * → `runSync`) on that cadence.
 *
 * Sources declare a cron in their manifest (`sources/<slug>.yaml`); until now
 * nothing acted on it — syncs were manual-only. This ensures one Schedule per
 * scheduled source, idempotently, so the reference deployments run themselves.
 *
 * Two cadences per source:
 *   - `schedule` → an INCREMENTAL sync (fetch what changed since the watermark)
 *   - `reconcileSchedule` → a FULL sync. Incremental runs can never observe
 *     upstream deletions (a deleted record stops matching `updated >=`), so
 *     only a periodic full pass — which re-yields everything in scope and lets
 *     the delete step prune the rest — keeps the index honest. The cron comes
 *     from the manifest, falling back to the connector's `defaultReconcileCron`.
 *
 * The options builders are pure (and unit-tested); the ensure/remove helpers
 * talk to a running Temporal and are exercised in the platform integration
 * suite.
 */

import type { ScheduleOptions } from '@temporalio/client';
import {
  getTemporalClient,
  SOURCE_SYNC_WORKFLOW,
  sourceReconcileScheduleIdFor,
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

function buildOptions(spec: SourceScheduleSpec, scheduleId: string, incremental: boolean): ScheduleOptions {
  return {
    scheduleId,
    spec: { cronExpressions: [spec.cron] },
    action: {
      type: 'startWorkflow',
      workflowType: SOURCE_SYNC_WORKFLOW,
      taskQueue: VOCION_WORKFLOWS_TASK_QUEUE,
      args: [{ orgId: spec.orgId, sourceId: spec.sourceId, incremental }],
    },
  };
}

/**
 * Build the Temporal `ScheduleOptions` for a source's recurring incremental
 * sync. Pure — no client, no I/O — so it's unit-testable.
 * @param spec
 */
export function buildSourceScheduleOptions(spec: SourceScheduleSpec): ScheduleOptions {
  return buildOptions(spec, sourceScheduleIdFor(spec.orgId, spec.sourceSlug), true);
}

/**
 * Build the Temporal `ScheduleOptions` for a source's recurring FULL sync —
 * the reconcile pass that prunes records deleted upstream. Pure.
 * @param spec
 */
export function buildSourceReconcileScheduleOptions(spec: SourceScheduleSpec): ScheduleOptions {
  return buildOptions(spec, sourceReconcileScheduleIdFor(spec.orgId, spec.sourceSlug), false);
}

async function ensureSchedule(options: ScheduleOptions): Promise<void> {
  const client = await getTemporalClient();
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

async function removeSchedule(scheduleId: string): Promise<void> {
  const client = await getTemporalClient();
  try {
    await client.schedule.getHandle(scheduleId).delete();
  } catch (err) {
    if (!isNotFound(err)) {
      throw err;
    }
  }
}

/**
 * Create (or update) the source's incremental sync Schedule. Idempotent — if
 * the Schedule already exists, its spec + action are updated in place.
 * @param spec
 */
export async function ensureSourceSchedule(spec: SourceScheduleSpec): Promise<void> {
  await ensureSchedule(buildSourceScheduleOptions(spec));
}

/**
 * Delete a source's incremental sync Schedule. No-op if it doesn't exist.
 * @param orgId
 * @param sourceSlug
 */
export async function removeSourceSchedule(orgId: string, sourceSlug: string): Promise<void> {
  await removeSchedule(sourceScheduleIdFor(orgId, sourceSlug));
}

/**
 * Create (or update) the source's full-sync reconcile Schedule. Idempotent.
 * @param spec
 */
export async function ensureSourceReconcileSchedule(spec: SourceScheduleSpec): Promise<void> {
  await ensureSchedule(buildSourceReconcileScheduleOptions(spec));
}

/**
 * Delete a source's reconcile Schedule. No-op if it doesn't exist.
 * @param orgId
 * @param sourceSlug
 */
export async function removeSourceReconcileSchedule(orgId: string, sourceSlug: string): Promise<void> {
  await removeSchedule(sourceReconcileScheduleIdFor(orgId, sourceSlug));
}

/**
 * Start a one-off FULL sync for a source, off the request path.
 *
 * Fired when workspace:apply changes a source's config — a widened project
 * include-list starts pulling immediately, and a narrowed one has its
 * out-of-scope documents pruned by the full run's delete step, instead of
 * either waiting for the next reconcile. The timestamp suffix keeps workflow
 * ids unique across repeated applies; if a sync is already running, the
 * workflow's activity surfaces SyncAlreadyRunningError and this run is a no-op.
 * @param spec
 * @param spec.orgId
 * @param spec.sourceId
 * @param spec.sourceSlug
 */
export async function startSourceFullSync(spec: { orgId: string; sourceId: number; sourceSlug: string }): Promise<void> {
  const client = await getTemporalClient();
  await client.workflow.start(SOURCE_SYNC_WORKFLOW, {
    taskQueue: VOCION_WORKFLOWS_TASK_QUEUE,
    workflowId: `source-config-sync-${spec.orgId}-${spec.sourceSlug}-${Date.now()}`,
    args: [{ orgId: spec.orgId, sourceId: spec.sourceId, incremental: false }],
  });
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
