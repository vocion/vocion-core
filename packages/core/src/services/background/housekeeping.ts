/**
 * What the executor does besides running durable work (v0.6.0): apply the
 * deployment-wide schedules, close out fires that can no longer end, and
 * drain the notification queue. The two sweeps are in-process timers rather
 * than durable schedules on purpose — a durable row every fifteen seconds
 * would be all the durable tables held, and both sweeps are idempotent reads
 * of rows that already carry their state.
 */

/** How often the executor sweeps for fires that can no longer end. */
const RECONCILE_EVERY_MS = 15 * 60_000;
/**
 * How often the notification queue is drained (backlog 048): retries, mail
 * held a minute for grouping, and anything quiet hours held. `notify()`
 * delivers what goes now itself; this is the rest.
 */
const NOTIFICATIONS_EVERY_MS = 15_000;

let started = false;

export async function startHousekeeping(): Promise<void> {
  if (started) {
    return;
  }
  started = true;

  try {
    const { applyDeploymentSchedules } = await import('./deploymentSchedules');
    const out = await applyDeploymentSchedules();
    console.warn('[durable] deployment schedules', out);
  } catch (err) {
    console.error('[durable] could not apply the deployment schedules', err);
  }

  // Every workspace's weekly org review, re-asserted: a workspace applied
  // before the review shipped has no schedule until this pass writes it.
  try {
    const { reconcileAllOrgReviewSchedules } = await import('@/services/orgReview/schedule');
    const out = await reconcileAllOrgReviewSchedules();
    console.warn('[durable] org review schedules', out);
  } catch (err) {
    console.error('[durable] could not reconcile the org review schedules', err);
  }

  // A fire whose process died mid-flight leaves its `automation_run` row
  // `running` for ever. This boot IS that restart, so reconcile now and then
  // keep sweeping: a row that cannot end is worse than one that ended badly.
  const reconcile = async (): Promise<void> => {
    try {
      const { reconcileAbandonedRuns } = await import('@/services/AutomationService');
      const { reconciled, ids } = await reconcileAbandonedRuns();
      if (reconciled > 0) {
        console.warn(`[durable] closed out ${reconciled} abandoned automation run(s): ${ids.join(', ')}`);
      }
    } catch (err) {
      console.error('[durable] abandoned-run reconciliation failed', err);
    }
  };
  void reconcile();
  setInterval(() => void reconcile(), RECONCILE_EVERY_MS).unref();

  let delivering = false;
  const deliver = async (): Promise<void> => {
    if (delivering) {
      return;
    }
    delivering = true;
    try {
      const { deliverDue } = await import('@/services/notifications/delivery');
      const out = await deliverDue();
      if (out.claimed > 0) {
        console.warn(`[durable] notifications: ${out.sent} sent, ${out.retrying} retrying, ${out.failed} failed, ${out.skipped} skipped`);
      }
    } catch (err) {
      console.error('[durable] notification delivery pass failed', err);
    } finally {
      delivering = false;
    }
  };
  setInterval(() => void deliver(), NOTIFICATIONS_EVERY_MS).unref();
}
