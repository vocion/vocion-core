/**
 * THE GATE BETWEEN "SOMEBODY ASKED FOR IT" AND "WE ARE GOING TO BUILD IT".
 *
 * The done gate refuses to call work finished while its contract is unmet.
 * This is the same sentence at the other end of the loop: a request may not
 * be planned until somebody has checked the thing is still missing from the
 * running product.
 *
 * On 2026-09-24 Chris asked which proposed feature was worth demoing end to
 * end. Two of the first rows checked had already shipped. "The dashboard has
 * one theme and no appearance setting" — the appearance setting is in the
 * account menu and on ⌘K. "add send/share to file detail page" — the share
 * half shipped six days earlier; only the send half was ever missing, and the
 * request went on asking for both. Nobody had done anything wrong: the board
 * records what was true when each ask arrived, and nothing re-reads it before
 * work starts.
 *
 * A backlog nobody re-checks decays into a list of things that used to be
 * true, and the cost lands at the worst moment — a planner writes a contract
 * for work that exists, a worker builds it twice, and the person who asked
 * gets told something shipped that shipped a week ago. Chris, 2026-09-24:
 * "Vocion should own that sweep. Not you… as part of the plan or replan
 * step."*
 *
 * So the check is not a sweep anybody remembers to run. It is a condition of
 * entering the states that mean work is about to happen, and like the done
 * gate it is refused in code rather than asked for in a prompt: a planner
 * cannot talk its way past a check it is never shown.
 */

/**
 * The states that mean work is about to happen. `in_scope` is the twenty
 * percent — a task will be written; `building` is a task dispatched. Both are
 * commitments of somebody's time, so both owe the check.
 */
const PLANNING_STATES: ReadonlySet<string> = new Set(['in_scope', 'building']);

/**
 * How long a gap check stays good, in days.
 *
 * A check is a statement about the product on the day it was made, and this
 * product ships several times a day. Long enough that triaging on Monday and
 * planning on Wednesday costs nothing; short enough that a request parked for
 * a month is looked at again before a worker is sent at it. This is also what
 * makes the gate bite on a REPLAN rather than only on a first plan.
 */
const CHECK_GOOD_FOR_DAYS = 14;

/**
 * What a gap check can conclude. Chris, 2026-09-24: *"with possible outcomes
 * of add, modify, or no action recommended"*.
 *
 *   - `add` — none of it exists. Plan it.
 *   - `modify` — part of it already ships, so the request as written asks for
 *     work that is partly done. Narrow it to the part that is missing and
 *     check that part; a half-true request builds the wrong thing twice.
 *   - `none` — it already ships. Close it with an honest answer saying where
 *     it landed and when.
 *
 * Only `add` is a licence to plan. The other two are findings that need a
 * person or an agent to act on the RECORD before anyone acts on the code,
 * which is the whole point of checking before the work starts rather than
 * after somebody has built it.
 */
export const GAP_FINDINGS = ['add', 'modify', 'none'] as const;

export type GapFinding = typeof GAP_FINDINGS[number];

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

/**
 * Why this request may not be planned yet, or `undefined` when it may.
 * @param current - The record's metadata as it stands.
 * @param set - The fields being written.
 * @param now - The moment to measure staleness against.
 * @returns The refusal, in the words the planner needs to act on it.
 */
export function gapRefusal(
  current: Record<string, unknown>,
  set: Record<string, unknown>,
  now: Date = new Date(),
): string | undefined {
  const nextState = typeof set.state === 'string' ? set.state : null;
  if (nextState === null || !PLANNING_STATES.has(nextState)) {
    return undefined;
  }
  const merged = { ...current, ...set };
  const check = asRecord(merged.gapCheck);
  const checkedAt = typeof check.checkedAt === 'string' ? new Date(check.checkedAt) : null;
  const finding = typeof check.finding === 'string' ? check.finding : null;
  const how = typeof check.how === 'string' && check.how.trim() !== '' ? check.how.trim() : null;
  const says = how === null ? '' : ` The check says: ${how}`;

  if (checkedAt === null || Number.isNaN(checkedAt.getTime()) || finding === null) {
    return `Not moved to ${nextState}: nobody has checked this is still missing. Look at the running product — the route, the screen, the endpoint it asks for — then record gapCheck.finding as one of add (none of it exists), modify (part of it already ships) or none (it all ships), with gapCheck.how naming what you looked at and gapCheck.checkedAt. Two of the first rows checked on this board in September had already shipped; a request is a statement about the product on the day it was asked, not today.`;
  }

  if (!(GAP_FINDINGS as readonly string[]).includes(finding)) {
    return `Not moved to ${nextState}: gapCheck.finding is "${finding}", which is not one of add, modify or none. Say which of the three the check found.`;
  }

  if (finding === 'none') {
    return `Not moved to ${nextState}: the gap check found this already ships.${says} Close it with an honest answer saying where it landed and when, in the asker's own terms. Building it again is the one outcome nobody wants.`;
  }

  if (finding === 'modify') {
    return `Not moved to ${nextState}: the gap check found part of this already ships.${says} Narrow the request to the part that does not — rename it and rewrite its story so it asks for that alone — then check the narrowed ask and record the new finding. A request that is half true builds the wrong thing.`;
  }

  const ageDays = (now.getTime() - checkedAt.getTime()) / 86_400_000;
  if (ageDays > CHECK_GOOD_FOR_DAYS) {
    const days = Math.floor(ageDays);
    return `Not moved to ${nextState}: the gap was last checked ${days} days ago and this product ships most days. Look again before a worker is sent at it, and re-stamp gapCheck.checkedAt with what you find.`;
  }

  return undefined;
}
