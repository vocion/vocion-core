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
    return await fireAutomation(input.orgId, input.slug, { invokedBy: `automation:${input.slug}` });
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
  }
}
