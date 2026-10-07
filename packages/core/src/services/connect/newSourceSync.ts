/**
 * A source saved from the Connectors page or from chat starts reading right
 * away (#1080). Before this, such a source got no schedule and no sync at all:
 * only a workspace-YAML source (`libs/sources/upsert.ts`) or one written
 * through `/api/v1` had schedules, so a source added by logging in sat empty
 * until someone pressed Sync now.
 *
 * It gets what a YAML source gets — an hourly incremental schedule, plus the
 * connector's nightly full pass when it declares one (Notion, Jira) — and its
 * first full sync starts now. A connector that does not sync (Apollo, Sentry)
 * gets none of it.
 *
 * Called after the save's transaction commits, so a job never points at a row
 * that rolled back. A failure here never undoes the save: the row stands, the
 * error is logged, and the Connectors page still offers Sync now.
 */
import { logger } from '@/libs/Logger';
import { getConnector } from '@/libs/sources/registry';
import { ensureSourceReconcileSchedule, ensureSourceSchedule, startSourceFullSync } from '@/services/SourceScheduleService';

/** The schedules a new source gets. */
export type NewSourceSyncPlan = {
  /** Hourly, at a minute picked from the source id. */
  incrementalCron: string;
  /** The connector's own full-pass cron, or null when it declares none. */
  reconcileCron: string | null;
};

/** What happened when a new source was set to sync, for the caller to report. */
export type FirstSync = 'started' | 'not_a_syncing_connector' | 'failed';

/**
 * Which schedules a newly saved source gets, or null for a connector that
 * does not sync. The incremental run is hourly; its minute comes from the
 * source id so a workspace's sources do not all fire at :00.
 * @param connectorSlug - The source's connector, e.g. `github`.
 * @param sourceId - The saved row's id.
 */
export function newSourceSyncPlan(connectorSlug: string, sourceId: number): NewSourceSyncPlan | null {
  const connector = getConnector(connectorSlug);
  if (!connector || connector.syncless === true) {
    return null;
  }
  return {
    incrementalCron: `${sourceId % 60} * * * *`,
    reconcileCron: connector.defaultReconcileCron ?? null,
  };
}

/**
 * Give a newly saved source its schedules and start its first full sync.
 * Never throws: a scheduler that is down is logged and reported as `failed`,
 * and the source keeps its Sync now button.
 * @param source - The source that was just saved.
 * @param source.orgId - The workspace.
 * @param source.sourceId - Its row.
 * @param source.sourceSlug - Its slug, which names its schedules.
 * @param source.connectorSlug - Its connector.
 */
export async function startNewSourceSync(source: { orgId: string; sourceId: number; sourceSlug: string; connectorSlug: string }): Promise<FirstSync> {
  const plan = newSourceSyncPlan(source.connectorSlug, source.sourceId);
  if (!plan) {
    return 'not_a_syncing_connector';
  }
  const spec = { orgId: source.orgId, sourceId: source.sourceId, sourceSlug: source.sourceSlug };
  try {
    await ensureSourceSchedule({ ...spec, cron: plan.incrementalCron });
    if (plan.reconcileCron) {
      await ensureSourceReconcileSchedule({ ...spec, cron: plan.reconcileCron });
    }
    await startSourceFullSync(spec);
    return 'started';
  } catch (error) {
    logger.error('a new source was saved but its schedule or first sync could not be started', {
      orgId: source.orgId,
      sourceId: source.sourceId,
      connector: source.connectorSlug,
      reason: error instanceof Error ? error.message : String(error),
    });
    return 'failed';
  }
}
