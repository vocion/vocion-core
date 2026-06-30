/**
 * Source-sync activity — the host-side wrapper that lets a Temporal
 * Workflow (and therefore a Temporal Schedule) drive `runSync`.
 *
 * Runs in the worker process (full Node access: DB, network, the vault).
 * `sourceSyncWorkflow` calls this via `proxyActivities`; a Schedule starts
 * that workflow on the source's cron. Incremental by default — a scheduled
 * run fetches only what changed since the last checkpoint.
 */

import type { SyncResult } from '@/services/SourceSyncService';
import { runSync } from '@/services/SourceSyncService';

export type SyncSourceActivityInput = {
  orgId: string;
  sourceId: number;
  /** Defaults to true — scheduled syncs are incremental. */
  incremental?: boolean;
};

export async function syncSourceActivity(input: SyncSourceActivityInput): Promise<SyncResult> {
  return runSync({
    orgId: input.orgId,
    sourceId: input.sourceId,
    incremental: input.incremental ?? true,
  });
}
