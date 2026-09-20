/**
 * Temporal client singleton (Phase H.1).
 *
 * Lazy-initialised connection to the Temporal Server. Lives behind
 * a per-process singleton so every API handler / Activity that
 * needs to send Signals or start Schedules shares one TCP/gRPC
 * channel.
 *
 * Connection target controlled by env:
 *   - VOCION_TEMPORAL_ADDRESS (default: 'localhost:7233')
 *   - VOCION_TEMPORAL_NAMESPACE (default: 'default')
 *
 * On AWS the address is the in-network DNS name `temporal:7233` (set
 * in `infra/aws/.env.production`).
 *
 * Note: this client is for the Vocion app process (Next.js). The
 * worker process (`scripts/temporal-worker.ts`) constructs its own
 * Worker via `@temporalio/worker` and shouldn't reuse this.
 */

import process from 'node:process';
import { Client, Connection } from '@temporalio/client';

let _conn: Connection | null = null;
let _client: Client | null = null;

export function temporalAddress(): string {
  return process.env.VOCION_TEMPORAL_ADDRESS ?? 'localhost:7233';
}

export function temporalNamespace(): string {
  return process.env.VOCION_TEMPORAL_NAMESPACE ?? 'default';
}

/**
 * How long to wait for the connection before giving up.
 *
 * The library's own default is 10 seconds, which is too long for anything a
 * person is waiting on. A request handler that calls this while Temporal is
 * unreachable holds the HTTP request open for the whole 10 seconds and only
 * then answers — long enough that browsers, test runners and load balancers
 * have usually given up first, so the caller sees a hang rather than the
 * honest error the handler was about to send. Five seconds is comfortably
 * longer than a healthy connect and short enough to answer inside a request.
 *
 * Raise it with VOCION_TEMPORAL_CONNECT_TIMEOUT_MS where the server is far
 * away or slow to accept.
 */
export function temporalConnectTimeoutMs(): number {
  const configured = Number(process.env.VOCION_TEMPORAL_CONNECT_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 5_000;
}

/** Resolve (and cache) the Temporal client. Idempotent. */
export async function getTemporalClient(): Promise<Client> {
  if (_client) {
    return _client;
  }
  _conn = await Connection.connect({
    address: temporalAddress(),
    connectTimeout: temporalConnectTimeoutMs(),
  });
  _client = new Client({ connection: _conn, namespace: temporalNamespace() });
  return _client;
}

/** Test-only escape hatch — drops the cached client. */
export async function resetTemporalClient(): Promise<void> {
  if (_conn) {
    try {
      await _conn.close();
    } catch {
      /* ignore */
    }
  }
  _conn = null;
  _client = null;
}

/**
 * Workflow ID convention — `workflow-run-<runId>`. Used to derive handles from a runId.
 * @param runId
 */
export function workflowIdForRun(runId: number): string {
  return `workflow-run-${runId}`;
}

/**
 * Schedule ID convention — `workflow-schedule-<orgId>-<slug>`.
 * @param orgId
 * @param slug
 */
export function scheduleIdFor(orgId: string, slug: string): string {
  return `workflow-schedule-${orgId}-${slug}`;
}

/**
 * Schedule ID convention for source syncs — `source-sync-<orgId>-<sourceSlug>`.
 * Distinct namespace from workflow schedules so the two never collide.
 * @param orgId
 * @param sourceSlug
 */
export function sourceScheduleIdFor(orgId: string, sourceSlug: string): string {
  return `source-sync-${orgId}-${sourceSlug}`;
}

/**
 * Schedule ID convention for source full-sync reconciles —
 * `source-reconcile-<orgId>-<sourceSlug>`. A source can carry both an
 * incremental Schedule and a reconcile Schedule; distinct prefixes keep
 * them independently creatable/deletable.
 * @param orgId
 * @param sourceSlug
 */
export function sourceReconcileScheduleIdFor(orgId: string, sourceSlug: string): string {
  return `source-reconcile-${orgId}-${sourceSlug}`;
}

export const VOCION_WORKFLOWS_TASK_QUEUE = 'vocion-workflows';

/** Workflow type name registered for scheduled source syncs. */
export const SOURCE_SYNC_WORKFLOW = 'sourceSyncWorkflow';

/** Workflow type a workflow-trigger Schedule starts — fires startWorkflow via activity. */
export const SCHEDULED_WORKFLOW_TRIGGER = 'scheduledWorkflowTrigger';

/** Workflow type a mission's Schedule starts — fires a check-mode mission run. */
export const MISSION_SCHEDULED_CHECK_WORKFLOW = 'missionScheduledCheck';

/** Workflow type an automation's Schedule starts — dispatches its `do`. */
export const AUTOMATION_FIRE_WORKFLOW = 'automationFire';

/** Workflow type the daily Langfuse retention Schedule starts. */
export const LANGFUSE_RETENTION_WORKFLOW = 'langfuseRetentionWorkflow';

/**
 * Schedule ID for Langfuse trace pruning.
 *
 * Deliberately not per-org: one Langfuse project holds every org's
 * traces, and the retention period is a deployment-wide setting, so one
 * Schedule covers the instance.
 */
export const LANGFUSE_RETENTION_SCHEDULE_ID = 'langfuse-retention';

/** ADR 0004 — reaps worker runs whose lease lapsed. One schedule per deployment, not per org. */
export const WORKER_RUN_REAPER_WORKFLOW = 'workerRunReaperWorkflow';
export const WORKER_RUN_REAPER_SCHEDULE_ID = 'worker-run-reaper';

/**
 * Schedule ID convention for automations — `automation-<orgId>-<slug>`.
 * @param orgId
 * @param slug
 */
export function automationScheduleIdFor(orgId: string, slug: string): string {
  return `automation-${orgId}-${slug}`;
}

/**
 * Workflow ID of the one coalesced fire an event automation may have
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
 * Schedule ID convention for mission schedules — `mission-schedule-<orgId>-<slug>`.
 * Distinct namespace from workflow + source schedules.
 * @param orgId
 * @param missionSlug
 */
export function missionScheduleIdFor(orgId: string, missionSlug: string): string {
  return `mission-schedule-${orgId}-${missionSlug}`;
}

/** Workflow type the eval refresh button and the eval Schedule both start. */
export const EVAL_REFRESH_WORKFLOW = 'evalRefreshWorkflow';

/**
 * Schedule ID convention for eval datasets — `eval-schedule-<orgId>-<slug>`.
 *
 * Matches `mission-schedule-` and `source-sync-` rather than inventing a
 * prefix. Deliberately not `eval-run-`, which would read as a sibling of
 * `workflow-run-<runId>` and mean something else entirely.
 * @param orgId - Whose workspace.
 * @param datasetSlug - Which dataset runs on this cron.
 */
export function evalScheduleIdFor(orgId: string, datasetSlug: string): string {
  return `eval-schedule-${orgId}-${datasetSlug}`;
}

/**
 * Workflow ID for one eval refresh.
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
