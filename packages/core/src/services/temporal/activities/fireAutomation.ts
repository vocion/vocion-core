/**
 * fireAutomation activity — dispatches an automation's `do` in the worker
 * process (full deps: workflow runner incl. agent steps, mission checks).
 *
 * Heartbeats while the pass runs. Without one, a pass that hangs fails only at
 * `startToCloseTimeout` and a timeout retry starts a second pass on top of a
 * first one that is still going. With one, Temporal knows the attempt is alive
 * and a retry cannot begin until it has stopped reporting.
 */

import { Context } from '@temporalio/activity';
import { fireAutomation } from '@/services/AutomationService';

export type FireAutomationActivityInput = {
  orgId: string;
  slug: string;
  /**
   * The one fire that stands in for the event fires the ceiling held back
   * (`when.maxFiresPer10m`). Started by `scheduleCoalescedFire` after the
   * window; absent on a schedule fire.
   */
  coalesce?: boolean;
  /**
   * A one-time replay of a specific past fire — `MissionService`'s stranded-
   * run reaper, dispatching the event fire whose run it just reaped. Carries
   * that fire's merged input (`automation_run.input`, kept exactly to
   * reproduce a run from) and an `invokedBy` stamped `reap-refire:<original>`
   * so the new run is marked as a replay and — since that prefix is not
   * `event:` — is never itself replayed if it strands too.
   */
  input?: Record<string, unknown>;
  invokedBy?: string;
};

/** How often the activity reports it is still alive. Well inside the 5-minute heartbeat timeout. */
const HEARTBEAT_EVERY_MS = 30_000;

export async function fireAutomationActivity(
  input: FireAutomationActivityInput,
): Promise<{ kind: string; runId: number }> {
  // `Context.current()` is only available when Temporal invokes this; the
  // in-process callers (events, CLI, the dashboard) go straight to
  // `fireAutomation`, so a missing context is not an error here.
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    const ctx = Context.current();
    ctx.heartbeat('starting');
    heartbeat = setInterval(() => {
      try {
        ctx.heartbeat('running');
      } catch {
        /* the attempt is over; the interval is cleared below */
      }
    }, HEARTBEAT_EVERY_MS);
  } catch {
    /* not running under Temporal */
  }

  try {
    if (input.coalesce) {
      // `event:` so the ceiling counts it as the event fire it is; the
      // `coalesced` suffix so the log tells it from the fires it replaced.
      return await fireAutomation(input.orgId, input.slug, { invokedBy: 'event:coalesced', coalesce: true });
    }
    if (input.invokedBy) {
      // A replay (see FireAutomationActivityInput.invokedBy) — carries the
      // original fire's input rather than the automation's default.
      return await fireAutomation(input.orgId, input.slug, { invokedBy: input.invokedBy, input: input.input });
    }
    return await fireAutomation(input.orgId, input.slug, { invokedBy: `automation:${input.slug}` });
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
  }
}
