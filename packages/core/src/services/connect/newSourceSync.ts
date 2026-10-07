/**
 * A source saved from the Connectors page or from chat starts reading right
 * away (#1080). Before this, such a source got no schedule and no sync at all:
 * only a workspace-YAML source (`libs/sources/upsert.ts`) or one written
 * through `/api/v1` had schedules, so a source added by logging in sat empty
 * until someone pressed Sync now.
 *
 * It gets what a YAML source gets — an hourly incremental schedule, plus the
 * connector's nightly full pass when it declares one (Notion, Jira) — and a
 * full sync starts now. A re-save of an existing source goes through here too:
 * its config changed, and a source saved before this existed gets the
 * schedules it never had. A connector that does not sync (Apollo, Sentry)
 * gets none of it.
 *
 * Called after the save's transaction commits, so a job never points at a row
 * that rolled back. A failure here never undoes the save: the row stands, the
 * error is logged, and the Connectors page still offers Sync now.
 */
import { logger } from '@/libs/Logger';
import { getConnector } from '@/libs/sources/registry';

/** How long a save waits on the scheduler before giving up on it and answering. */
const SCHEDULER_TIMEOUT_MS = 5_000;

/** The schedules a saved source gets. */
export type NewSourceSyncPlan = {
  /** Hourly, at a minute picked from the source id. */
  incrementalCron: string;
  /** The connector's own full-pass cron, or null when it declares none. */
  reconcileCron: string | null;
};

/** Whether the saved source's sync started, for the page to say so. */
export type FirstSync = 'started' | 'not_a_syncing_connector' | 'failed';

/**
 * Which schedules a saved source gets, or null for a connector that does not
 * sync. The incremental run is hourly; its minute comes from the source id so
 * a workspace's sources do not all fire at :00.
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
 * A promise that rejects once the scheduler has had `ms` to answer.
 * @param ms - How long to wait.
 * @param timer - Receives the handle, so the caller can clear it.
 * @param timer.handle - The pending timeout.
 */
function schedulerDeadline(ms: number, timer: { handle?: ReturnType<typeof setTimeout> }): Promise<never> {
  return new Promise<never>((_, reject) => {
    timer.handle = setTimeout(reject, ms, new Error(`the scheduler did not answer within ${ms}ms`));
  });
}

/**
 * The scheduler calls, in order, each step named so a failure says which.
 * The scheduler module is loaded here rather than at the top, as every other
 * caller does, so importing the save path does not load the durable engine.
 * @param spec - The source.
 * @param spec.orgId - The workspace.
 * @param spec.sourceId - Its row.
 * @param spec.sourceSlug - Its slug, which names its schedules.
 * @param plan - Its schedules.
 * @param progress - Records the step reached, for the log.
 * @param progress.step - The step in flight.
 */
async function scheduleAndStart(
  spec: { orgId: string; sourceId: number; sourceSlug: string },
  plan: NewSourceSyncPlan,
  progress: { step: string },
): Promise<void> {
  const { ensureSourceReconcileSchedule, ensureSourceSchedule, startSourceFullSync } = await import('@/services/SourceScheduleService');
  progress.step = 'hourly schedule';
  await ensureSourceSchedule({ ...spec, cron: plan.incrementalCron });
  if (plan.reconcileCron) {
    progress.step = 'nightly full-pass schedule';
    await ensureSourceReconcileSchedule({ ...spec, cron: plan.reconcileCron });
  }
  progress.step = 'first full sync';
  await startSourceFullSync(spec);
}

/**
 * Give a saved source its schedules and start a full sync of it. Never throws
 * and never waits on the scheduler longer than SCHEDULER_TIMEOUT_MS: a
 * scheduler that is down or hung is logged with the step it failed at and
 * reported as `failed`, and the source keeps its Sync now button.
 * @param source - The source that was just saved.
 * @param source.orgId - The workspace.
 * @param source.sourceId - Its row.
 * @param source.sourceSlug - Its slug, which names its schedules.
 * @param source.connectorSlug - Its connector.
 */
export async function startSourceSyncing(source: { orgId: string; sourceId: number; sourceSlug: string; connectorSlug: string }): Promise<FirstSync> {
  const progress = { step: 'plan' };
  const timer: { handle?: ReturnType<typeof setTimeout> } = {};
  try {
    const plan = newSourceSyncPlan(source.connectorSlug, source.sourceId);
    if (!plan) {
      return 'not_a_syncing_connector';
    }
    const spec = { orgId: source.orgId, sourceId: source.sourceId, sourceSlug: source.sourceSlug };
    await Promise.race([scheduleAndStart(spec, plan, progress), schedulerDeadline(SCHEDULER_TIMEOUT_MS, timer)]);
    return 'started';
  } catch (error) {
    logger.error('a source was saved but its schedule or sync could not be started', {
      orgId: source.orgId,
      sourceId: source.sourceId,
      connector: source.connectorSlug,
      step: progress.step,
      reason: error instanceof Error ? error.message : String(error),
    });
    return 'failed';
  } finally {
    clearTimeout(timer.handle);
  }
}
