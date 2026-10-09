/**
 * Source-sync job — the host-side wrapper that lets a durable schedule drive
 * `runSync`.
 *
 * Runs on the durable executor (full Node access: DB, network, the vault).
 * The `source.sync` job calls this as a retried step; a schedule starts it on
 * the source's cron. Incremental by default — a scheduled
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
  // NEVER CONNECTED IS NOT A FAILURE (2026-10-02): nine sources declared in
  // workspaces and never connected failed every tick, three attempts each,
  // ~16 errors an hour that buried the real ones. A source that has never
  // synced and has no credential skips quietly; the Sources page already says
  // "Needs credentials", and the first tick after someone connects it syncs.
  if (await neverConnected(input.orgId, input.sourceId)) {
    return { ...skippedResult(input.sourceId), firstError: 'not connected' };
  }
  // A paused connection keeps its schedule and skips each tick quietly, so
  // Resume needs nothing rebuilt.
  const { isSourcePaused } = await import('@/services/SourceSyncService');
  if (await isSourcePaused(input.orgId, input.sourceId)) {
    return { ...skippedResult(input.sourceId), firstError: 'paused' };
  }
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
      return skippedResult(input.sourceId);
    }
    throw err;
  }
}

function skippedResult(sourceId: number): SyncSourceActivityResult {
  return { sourceId, created: 0, updated: 0, unchanged: 0, metadataRefreshed: 0, tombstoned: 0, errors: 0, firstError: null, firstProcessorError: null, skipped: true };
}

/**
 * True for a source that has never synced and whose connector needs a
 * credential nobody has connected — read the way the Sources page reads it,
 * so the page and the schedule agree. A source that synced once is never
 * skipped here: its failures are real and stay loud.
 * @param orgId - The workspace.
 * @param sourceId - The source.
 */
async function neverConnected(orgId: string, sourceId: number): Promise<boolean> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { knowledgeSourceSchema } = await import('@/models/Schema');
  const [row] = await db.select({ slug: knowledgeSourceSchema.slug, config: knowledgeSourceSchema.configJson, lastSyncedAt: knowledgeSourceSchema.lastSyncedAt })
    .from(knowledgeSourceSchema)
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.id, sourceId)));
  if (!row || row.lastSyncedAt) {
    return false;
  }
  const { listConnectors } = await import('@/libs/sources/registry');
  const connectorSlug = (row.config?._connector as string | undefined) ?? row.slug;
  const authKind = listConnectors().find(c => c.slug === connectorSlug)?.authKind ?? 'none';
  if (authKind === 'none') {
    return false;
  }
  const { credentialStatusForOrg } = await import('@/services/SourceCredentialService');
  const status = await credentialStatusForOrg(orgId);
  return !(status.bySourceId[sourceId] ?? status.byConnectorSlug[connectorSlug])?.connected;
}
