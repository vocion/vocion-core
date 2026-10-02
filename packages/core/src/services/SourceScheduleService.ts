/**
 * SourceScheduleService — turns a source's `schedule` cron into a durable
 * schedule that runs the `source.sync` job (→ `syncSourceActivity` →
 * `runSync`) on that cadence.
 *
 * Two cadences per source:
 *   - `schedule` → an INCREMENTAL sync (fetch what changed since the watermark)
 *   - `reconcileSchedule` → a FULL sync. Incremental runs can never observe
 *     upstream deletions (a deleted record stops matching `updated >=`), so
 *     only a periodic full pass — which re-yields everything in scope and lets
 *     the delete step prune the rest — keeps the index honest. The cron comes
 *     from the manifest, falling back to the connector's `defaultReconcileCron`.
 *
 * The spec builders are pure (and unit-tested); ensure/remove go through the
 * durable engine (`libs/durable/jobs.ts`).
 */

import type { ScheduleSpec } from '@/libs/durable/jobs';
import { scheduleJob, startJob, unscheduleJob } from '@/libs/durable/jobs';
import { sourceReconcileScheduleIdFor, sourceScheduleIdFor } from '@/libs/durable/scheduleIds';
import { JOB } from '@/services/background/catalog';

export type SourceScheduleSpec = {
  orgId: string;
  sourceId: number;
  sourceSlug: string;
  /** Cron expression from the source manifest, e.g. `0 6 * * *`. */
  cron: string;
};

function build(spec: SourceScheduleSpec, name: string, incremental: boolean): ScheduleSpec {
  return { name, cron: spec.cron, job: JOB.sourceSync, input: { orgId: spec.orgId, sourceId: spec.sourceId, incremental } };
}

/**
 * The schedule for a source's recurring incremental sync. Pure.
 * @param spec - The source and its cron.
 */
export function sourceScheduleSpec(spec: SourceScheduleSpec): ScheduleSpec {
  return build(spec, sourceScheduleIdFor(spec.orgId, spec.sourceSlug), true);
}

/**
 * The schedule for a source's recurring FULL sync — the reconcile pass that
 * prunes records deleted upstream. Pure.
 * @param spec - The source and its reconcile cron.
 */
export function sourceReconcileScheduleSpec(spec: SourceScheduleSpec): ScheduleSpec {
  return build(spec, sourceReconcileScheduleIdFor(spec.orgId, spec.sourceSlug), false);
}

/**
 * Create (or update) the source's incremental sync schedule. Idempotent.
 * @param spec
 */
export async function ensureSourceSchedule(spec: SourceScheduleSpec): Promise<void> {
  await scheduleJob(sourceScheduleSpec(spec));
}

/**
 * Delete a source's incremental sync schedule. No-op if it doesn't exist.
 * @param orgId
 * @param sourceSlug
 */
export async function removeSourceSchedule(orgId: string, sourceSlug: string): Promise<void> {
  await unscheduleJob(sourceScheduleIdFor(orgId, sourceSlug));
}

/**
 * Create (or update) the source's full-sync reconcile schedule. Idempotent.
 * @param spec
 */
export async function ensureSourceReconcileSchedule(spec: SourceScheduleSpec): Promise<void> {
  await scheduleJob(sourceReconcileScheduleSpec(spec));
}

/**
 * Delete a source's reconcile schedule. No-op if it doesn't exist.
 * @param orgId
 * @param sourceSlug
 */
export async function removeSourceReconcileSchedule(orgId: string, sourceSlug: string): Promise<void> {
  await unscheduleJob(sourceReconcileScheduleIdFor(orgId, sourceSlug));
}

/**
 * Start a one-off FULL sync for a source, off the request path.
 *
 * Fired when workspace:apply changes a source's config — a widened project
 * include-list starts pulling immediately, and a narrowed one has its
 * out-of-scope documents pruned by the full run's delete step, instead of
 * either waiting for the next reconcile. The timestamp keeps ids unique across
 * repeated applies; if a sync is already running, the job surfaces
 * SyncAlreadyRunningError and this run is a no-op.
 * @param spec - The source.
 * @param spec.orgId - Tenant.
 * @param spec.sourceId - Its row.
 * @param spec.sourceSlug - Its slug.
 */
export async function startSourceFullSync(spec: { orgId: string; sourceId: number; sourceSlug: string }): Promise<void> {
  await startJob(`source-config-sync-${spec.orgId}-${spec.sourceSlug}-${Date.now()}`, {
    job: JOB.sourceSync,
    input: { orgId: spec.orgId, sourceId: spec.sourceId, incremental: false },
  });
}
