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

/** Resolve (and cache) the Temporal client. Idempotent. */
export async function getTemporalClient(): Promise<Client> {
  if (_client) {
    return _client;
  }
  _conn = await Connection.connect({ address: temporalAddress() });
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

export const VOCION_WORKFLOWS_TASK_QUEUE = 'vocion-workflows';

/** Workflow type name registered for scheduled source syncs. */
export const SOURCE_SYNC_WORKFLOW = 'sourceSyncWorkflow';

/** Workflow type a workflow-trigger Schedule starts — fires startWorkflow via activity. */
export const SCHEDULED_WORKFLOW_TRIGGER = 'scheduledWorkflowTrigger';

/** Workflow type a mission's Schedule starts — fires a check-mode mission run. */
export const MISSION_SCHEDULED_CHECK_WORKFLOW = 'missionScheduledCheck';

/**
 * Schedule ID convention for mission schedules — `mission-schedule-<orgId>-<slug>`.
 * Distinct namespace from workflow + source schedules.
 * @param orgId
 * @param missionSlug
 */
export function missionScheduleIdFor(orgId: string, missionSlug: string): string {
  return `mission-schedule-${orgId}-${missionSlug}`;
}
