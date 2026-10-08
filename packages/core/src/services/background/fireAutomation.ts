/**
 * fireAutomation activity — dispatches an automation's `do` in the worker
 * process (full deps: workflow runner incl. agent steps, mission checks).
 *
 * Runs as a durable job step (`background/catalog.ts`): DBOS recovers an
 * interrupted pass on the executor's restart rather than racing a second one.
 */

import { fireAutomation, recordSkippedFire, scheduleFireInFlight } from '@/services/AutomationService';

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

export async function fireAutomationActivity(
  input: FireAutomationActivityInput,
): Promise<{ kind: string; runId: number }> {
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
  // A schedule tick never overlaps its own last fire: a pass that can claim
  // leads must not run beside itself. The tick that finds one in flight is
  // skipped, and the strip shows the gap.
  const inFlight = await scheduleFireInFlight(input.orgId, input.slug);
  if (inFlight !== null) {
    return { kind: 'skipped', runId: inFlight };
  }
  // PARKED ON ITS QUESTIONS (`needsYou/ResumeGateService.ts`): everything this
  // automation had left to do waits on asks, so its schedule spends nothing
  // until they are answered. Only the tick is held — an event still fires,
  // and a person's Run now is their word. Written down like any refusal.
  const held = await waitingOn(input.orgId, input.slug);
  if (held !== null) {
    return { kind: 'skipped', runId: held };
  }
  return await fireAutomation(input.orgId, input.slug, { invokedBy: `automation:${input.slug}` });
}

/**
 * The skipped run row for a schedule tick held by a resume gate, or null when
 * no gate holds this automation.
 * @param orgId - The workspace.
 * @param slug - The automation whose schedule ticked.
 */
async function waitingOn(orgId: string, slug: string): Promise<number | null> {
  const { automationHold } = await import('@/services/needsYou/ResumeGateService');
  const gate = await automationHold(orgId, slug);
  if (!gate) {
    return null;
  }
  const invokedBy = `automation:${slug}`;
  const n = gate.waitingOn.length;
  return recordSkippedFire(orgId, slug, {
    event: invokedBy,
    payload: {},
    invokedBy,
    result: {
      kind: 'skipped',
      reason: 'waiting_on_ask',
      detail: `waiting on ${n === 1 ? 'a question' : `${n} questions`} on Needs you${gate.gateAskId ? ` (ask #${gate.gateAskId})` : ''} — it runs again once ${n === 1 ? 'it is' : 'they are'} answered`,
      event: invokedBy,
      causedBy: null,
    },
  });
}
