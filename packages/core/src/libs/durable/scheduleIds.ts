/**
 * The names background work runs under (v0.6.0, backlog 054). A schedule's
 * name is what pause, remove and describe address on the durable engine; a
 * one-off start's id is its idempotency key. The prefixes are the ones the
 * durable schedules used, so a log line or a run id reads the same across
 * the cutover.
 */

/**
 * Run id convention — `workflow-run-<runId>`. Used to derive handles from a runId.
 * @param runId
 */
export function workflowIdForRun(runId: number): string {
  return `workflow-run-${runId}`;
}

/**
 * Schedule name convention — `workflow-schedule-<orgId>-<slug>`.
 * @param orgId
 * @param slug
 */
export function scheduleIdFor(orgId: string, slug: string): string {
  return `workflow-schedule-${orgId}-${slug}`;
}

/**
 * Schedule name convention for source syncs — `source-sync-<orgId>-<sourceSlug>`.
 * Distinct namespace from workflow schedules so the two never collide.
 * @param orgId
 * @param sourceSlug
 */
export function sourceScheduleIdFor(orgId: string, sourceSlug: string): string {
  return `source-sync-${orgId}-${sourceSlug}`;
}

/**
 * Schedule name convention for source full-sync reconciles —
 * `source-reconcile-<orgId>-<sourceSlug>`. A source can carry both an
 * incremental Schedule and a reconcile Schedule; distinct prefixes keep
 * them independently creatable/deletable.
 * @param orgId
 * @param sourceSlug
 */
export function sourceReconcileScheduleIdFor(orgId: string, sourceSlug: string): string {
  return `source-reconcile-${orgId}-${sourceSlug}`;
}

/**
 * Schedule name for Langfuse trace pruning.
 *
 * Deliberately not per-org: one Langfuse project holds every org's
 * traces, and the retention period is a deployment-wide setting, so one
 * Schedule covers the instance.
 */
export const LANGFUSE_RETENTION_SCHEDULE_ID = 'langfuse-retention';

/** ADR 0004 — reaps worker runs whose lease lapsed. One schedule per deployment, not per org. */
export const WORKER_RUN_REAPER_SCHEDULE_ID = 'worker-run-reaper';

/**
 * Reaps mission runs stranded by a dead process (no lease to lapse — mission
 * runs execute in-process). One schedule per deployment, not per org, same
 * shape and cadence as the worker-run reaper above.
 */
export const MISSION_RUN_REAPER_SCHEDULE_ID = 'mission-run-reaper';

/**
 * Retries image artifacts whose copy into the artifact store failed, while
 * their source links are still valid (`services/artifacts/imageIngest.ts`).
 * One schedule per deployment, hourly.
 */
export const ARTIFACT_IMAGE_SWEEP_SCHEDULE_ID = 'artifact-image-sweep';

/**
 * The clock on every decision waiting on Needs you: escalates, applies
 * defaults at their deadlines, holds what the trust ladder keeps, and resumes
 * runs whose questions were answered (`services/needsYou/`). One schedule per
 * deployment, every five minutes.
 */
export const NEEDS_YOU_SWEEP_SCHEDULE_ID = 'needs-you-sweep';

/**
 * Run id for the one-time replay of an event automation whose run the
 * mission-run reaper just reaped — `automation-refire-<orgId>-<automationRunId>-<missionRunId>`.
 * Keyed on both ids so a retried reap sweep that reaches the same stranded
 * run twice finds the replay already started rather than dispatching a
 * second one.
 * @param orgId
 * @param automationRunId - The fire being replayed.
 * @param missionRunId - The stranded run that fire started.
 */
export function automationRefireWorkflowIdFor(orgId: string, automationRunId: number, missionRunId: number): string {
  return `automation-refire-${orgId}-${automationRunId}-${missionRunId}`;
}

/**
 * Schedule name convention for automations — `automation-<orgId>-<slug>`.
 * @param orgId
 * @param slug
 */
export function automationScheduleIdFor(orgId: string, slug: string): string {
  return `automation-${orgId}-${slug}`;
}

/**
 * Run id of the one coalesced fire an event automation may have
 * waiting — `automation-coalesced-<orgId>-<slug>`. Per automation and not
 * per window on purpose: a second held fire while one is waiting must find
 * this id taken, which is what makes the held fires one run instead of many.
 * @param orgId
 * @param slug
 */
export function automationCoalescedWorkflowIdFor(orgId: string, slug: string): string {
  return `automation-coalesced-${orgId}-${slug}`;
}

/**
 * Schedule name convention for mission schedules — `mission-schedule-<orgId>-<slug>`.
 * Distinct namespace from workflow + source schedules.
 * @param orgId
 * @param missionSlug
 */
export function missionScheduleIdFor(orgId: string, missionSlug: string): string {
  return `mission-schedule-${orgId}-${missionSlug}`;
}

/**
 * Run id for one eval refresh.
 *
 * Doubles as the run group: the workflow passes its own id to the activity, so
 * an at-least-once retry reuses the run rows already created instead of adding
 * a second point to the trend line for work that happened once.
 * @param orgId - Whose workspace.
 * @param datasetSlug - Which dataset.
 * @param startedAt - Milliseconds since the epoch, so two refreshes of the
 * same dataset are different runs while one retried refresh is not.
 */
export function evalRefreshWorkflowIdFor(orgId: string, datasetSlug: string, startedAt: number): string {
  return `eval-refresh-${orgId}-${datasetSlug}-${startedAt}`;
}
