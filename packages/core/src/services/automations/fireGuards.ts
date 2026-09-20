/**
 * The two rules that stop an event automation from running away.
 *
 * On 20 September 2026 `wiki-debrief` subscribed to `mission_run.completed`.
 * Each of its fires is a mission check; each check is a mission run; each
 * run's completion raised `mission_run.completed`; which fired it again.
 * Sixty runs spawned in minutes before a person cancelled them by hand.
 * PR #503 had guarded one event type (`automation_run.completed`) against
 * one shape of this. These rules are the generic version, and they are pure
 * so the matcher's decision can be tested without a database.
 *
 *   1. **An automation never fires on its own run's event.** Every fire
 *      stamps itself on the work it starts (`mission_run.caused_by`), the
 *      work stamps the chain on the events it raises, and a candidate whose
 *      slug is anywhere on the chain is skipped. A candidate is also skipped
 *      when the mission run that completed belongs to the mission the
 *      candidate itself checks — the chain can be missing (a run started
 *      before this landed) and the loop is the same.
 *   2. **A ceiling per automation.** `when.maxFiresPer10m` (default 6)
 *      bounds event fires in a rolling ten-minute window; beyond it the fires
 *      are held and coalesced into one run after the window. A schedule fires
 *      on its cron and is not counted.
 */

/** One link in the chain: the automation fire and the run it started. */
export type CausalLink = {
  automationSlug: string;
  /** The `automation_run` row of the fire. */
  automationRunId?: number;
  /** The mission run the fire started, when it was a mission check. */
  missionRunId?: number;
};

/** The fires that led to a piece of work, newest first. */
export type CausalChain = CausalLink[];

/**
 * The deepest chain carried forward. A chain longer than this means distinct
 * automations are handing work to each other in a ring, and the ceiling
 * below is what bounds that; the guard only needs the recent links.
 */
export const MAX_CHAIN_LENGTH = 8;

/** The rolling window the event-fire ceiling is measured over. */
export const RATE_LIMIT_WINDOW_MS = 10 * 60_000;

/**
 * Fires an event automation may make in one window when its `when` names no
 * ceiling. Six: an hourly cadence's worth of debriefs in ten minutes is a
 * busy afternoon, and sixty is the incident.
 */
export const DEFAULT_MAX_FIRES_PER_10M = 6;

/** The reasons a fire is refused, as the `skipped` run row records them. */
export type SkipReason = 'self_trigger' | 'rate_limited';

/**
 * Prepend this fire to the chain that led to it.
 * @param link - The fire being made.
 * @param parent - The chain on the event that fired it, if any.
 */
export function extendChain(link: CausalLink, parent: CausalChain | null | undefined): CausalChain {
  return [link, ...(parent ?? [])].slice(0, MAX_CHAIN_LENGTH);
}

/**
 * The ceiling an event-when is held to. A schedule-when has none.
 * @param when - The automation's `whenConfig`.
 * @param when.event
 * @param when.schedule
 * @param when.maxFiresPer10m
 */
export function eventFireCeiling(when: { event?: string | string[]; schedule?: string; maxFiresPer10m?: number }): number | null {
  if (!when.event) {
    return null;
  }
  const authored = when.maxFiresPer10m;
  return typeof authored === 'number' && Number.isInteger(authored) && authored >= 1 ? authored : DEFAULT_MAX_FIRES_PER_10M;
}

/**
 * Why this event must not fire this automation — or null when it may.
 *
 * Two checks, in order. The chain: the candidate's slug is on the list of
 * fires that produced the event, so the event is its own run's residue. The
 * mission: the run that completed is a check of the very mission the
 * candidate checks, which is the same loop seen from the payload alone.
 * @param candidate - The automation the matcher is looking at.
 * @param candidate.slug
 * @param candidate.doConfig
 * @param candidate.doConfig.checkMission
 * @param event - The event being dispatched, with the chain it carries.
 * @param event.type
 * @param event.payload
 * @param event.causedBy
 */
export function selfTriggerReason(
  candidate: { slug: string; doConfig: { checkMission?: string } },
  event: { type: string; payload: Record<string, unknown>; causedBy?: CausalChain | null },
): string | null {
  const own = (event.causedBy ?? []).find(link => link.automationSlug === candidate.slug);
  if (own) {
    const via = own.missionRunId ? `mission run ${own.missionRunId}` : own.automationRunId ? `automation run ${own.automationRunId}` : 'its own run';
    return `${event.type} was raised by ${via}, which automation "${candidate.slug}" itself started`;
  }
  const missionSlug = event.payload.missionSlug;
  if (candidate.doConfig.checkMission && typeof missionSlug === 'string' && missionSlug === candidate.doConfig.checkMission) {
    return `${event.type} is a run of mission "${missionSlug}", the mission automation "${candidate.slug}" checks`;
  }
  return null;
}
