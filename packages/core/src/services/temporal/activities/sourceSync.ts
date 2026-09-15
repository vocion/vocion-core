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
import { runSync, SyncAlreadyRunningError } from '@/services/SourceSyncService';

export type SyncSourceActivityInput = {
  orgId: string;
  sourceId: number;
  /** Defaults to true — scheduled syncs are incremental. */
  incremental?: boolean;
};

export type SyncSourceActivityResult = SyncResult & {
  /**
   * True when another run already held the source, so this one did nothing.
   * Additive: every other field is the zeroed shape of a run that saved
   * nothing, so a caller that only reads counts still reads a valid result.
   */
  skipped?: boolean;
};

export async function syncSourceActivity(input: SyncSourceActivityInput): Promise<SyncSourceActivityResult> {
  try {
    return await runSync({
      orgId: input.orgId,
      sourceId: input.sourceId,
      incremental: input.incremental ?? true,
    });
  } catch (err) {
    // Another run holds this source, a schedule that overlapped its own
    // previous tick, or `POST /api/v1/sources/:slug/sync` landing while the
    // cron run is still going. Not a fault: letting it propagate makes the
    // workflow retry twice at 0/5/15s against a 30-minute takeover window and
    // then fail the run, which reads as a broken schedule. Report the skip and
    // let the run that holds the source finish.
    if (err instanceof SyncAlreadyRunningError) {
      return {
        sourceId: input.sourceId,
        created: 0,
        updated: 0,
        unchanged: 0,
        metadataRefreshed: 0,
        tombstoned: 0,
        errors: 0,
        firstError: null,
        firstProcessorError: null,
        skipped: true,
      };
    }
    throw err;
  }
}
