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
 * How far a save's scheduler calls got, shared between the calls and the
 * deadline racing them.
 */
type SchedulerProgress = {
  /** The step in flight, for the log. */
  step: string;
  /** Set when the deadline fired: the save has answered `failed`, so nothing more may start. */
  timedOut: boolean;
  /** The pending deadline, so it can be cleared. */
  timer?: ReturnType<typeof setTimeout>;
};

/**
 * The deadline firing: mark the save as answered, then fail the race.
 * @param progress - The save's progress.
 * @param reject - Fails the deadline's promise.
 * @param ms - How long the scheduler had.
 */
function expireSchedulerDeadline(progress: SchedulerProgress, reject: (reason: Error) => void, ms: number): void {
  progress.timedOut = true;
  reject(new Error(`the scheduler did not answer within ${ms}ms`));
}

/**
 * A promise that rejects once the scheduler has had `ms` to answer. The
 * Promise constructor's executor is the one callback here: it has no
 * module-level form, since `reject` only exists inside it.
 * @param ms - How long to wait.
 * @param progress - Receives the timer, and is marked when it fires.
 */
function schedulerDeadline(ms: number, progress: SchedulerProgress): Promise<never> {
  return new Promise<never>((_, reject) => {
    progress.timer = setTimeout(expireSchedulerDeadline, ms, progress, reject, ms);
  });
}

/**
 * The scheduler calls, in order, each step named so a failure says which.
 * Once the deadline has fired the save has already told the person the sync
 * could not start, so a scheduler that answers late gets no further: the
 * step in flight may still land, but the next one, and the sync, never start.
 * The scheduler module is loaded here rather than at the top, as every other
 * caller does, so importing the save path does not load the durable engine.
 * @param spec - The source.
 * @param spec.orgId - The workspace.
 * @param spec.sourceId - Its row.
 * @param spec.sourceSlug - Its slug, which names its schedules.
 * @param plan - Its schedules.
 * @param progress - Records the step reached, and whether the deadline fired.
 */
async function scheduleAndStart(
  spec: { orgId: string; sourceId: number; sourceSlug: string },
  plan: NewSourceSyncPlan,
  progress: SchedulerProgress,
): Promise<void> {
  const { ensureSourceReconcileSchedule, ensureSourceSchedule, startSourceFullSync } = await import('@/services/SourceScheduleService');
  progress.step = 'hourly schedule';
  await ensureSourceSchedule({ ...spec, cron: plan.incrementalCron });
  if (plan.reconcileCron && !progress.timedOut) {
    progress.step = 'nightly full-pass schedule';
    await ensureSourceReconcileSchedule({ ...spec, cron: plan.reconcileCron });
  }
  if (progress.timedOut) {
    return;
  }
  progress.step = 'first full sync';
  await startSourceFullSync(spec);
}

/**
 * Log a scheduler call that failed after the save stopped waiting for it.
 * The race already logged the timeout, but this failure says why, and nothing
 * else would ever see it.
 * @param source - The saved source.
 * @param source.orgId - The workspace.
 * @param source.sourceId - Its row.
 * @param source.connectorSlug - Its connector.
 * @param progress - The save's progress.
 * @param error - What the late call threw.
 */
function logLateSchedulerFailure(source: { orgId: string; sourceId: number; connectorSlug: string }, progress: SchedulerProgress, error: unknown): void {
  if (!progress.timedOut) {
    return;
  }
  logger.error('a scheduler call failed after the save stopped waiting for it', {
    orgId: source.orgId,
    sourceId: source.sourceId,
    connector: source.connectorSlug,
    step: progress.step,
    reason: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Give a saved source its schedules and start a full sync of it. Never throws
 * and never waits on the scheduler longer than SCHEDULER_TIMEOUT_MS: a
 * scheduler that is down or hung is logged with the step it failed at and
 * reported as `failed`, and the source keeps its Sync now button. A scheduler
 * that answers after that is not cancelled, but it starts nothing more, so
 * `failed` stays true: no sync begins behind it.
 * @param source - The source that was just saved.
 * @param source.orgId - The workspace.
 * @param source.sourceId - Its row.
 * @param source.sourceSlug - Its slug, which names its schedules.
 * @param source.connectorSlug - Its connector.
 */
export async function startSourceSyncing(source: { orgId: string; sourceId: number; sourceSlug: string; connectorSlug: string }): Promise<FirstSync> {
  const progress: SchedulerProgress = { step: 'plan', timedOut: false };
  try {
    const plan = newSourceSyncPlan(source.connectorSlug, source.sourceId);
    if (!plan) {
      return 'not_a_syncing_connector';
    }
    const spec = { orgId: source.orgId, sourceId: source.sourceId, sourceSlug: source.sourceSlug };
    const scheduling = scheduleAndStart(spec, plan, progress);
    scheduling.catch(error => logLateSchedulerFailure(source, progress, error));
    await Promise.race([scheduling, schedulerDeadline(SCHEDULER_TIMEOUT_MS, progress)]);
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
    clearTimeout(progress.timer);
  }
}
