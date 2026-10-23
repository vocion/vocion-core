/**
 * A RECORD'S OWN LIFECYCLE — the row's `status`, on a type that declares no
 * `status` field of its own.
 *
 * One definition for the agent's write (`objects.update_meta`, which moves the
 * row when `set` carries `status`) and for the person's buttons on the record
 * (`features/dashboard/objects/RecordLifecycle`): the same states, and the
 * same rail, so Done in the preview is the run an agent's close would be, with
 * Undo (2026-10-23: fifteen follow-ups nobody could close, from chat or from
 * the record).
 *
 * A type that declares its own `status` (the factory's request) moves it by
 * its transitions and is not this lifecycle.
 *
 * Which types SHOW the verbs is the type's word, not core's guess: a type
 * whose records are things owed — a follow-up, a to-do — says `x-owed: true`
 * in its schema, and its records offer Do it, Done and Drop. A product or a
 * company has a lifecycle too, and Done on one would be nonsense.
 */

export const ROW_STATUSES = ['open', 'active', 'done', 'closed', 'dropped', 'archived'] as const;
export type RowStatus = (typeof ROW_STATUSES)[number];

/** The states a record is finished in: off the list of what is owed. */
const FINISHED: ReadonlySet<string> = new Set(['done', 'closed', 'dropped', 'archived']);

/**
 * Whether a type's records move through the row lifecycle: it declares no
 * `status` field of its own.
 * @param schema - The type's JSON Schema, or null.
 */
export function hasRowLifecycle(schema: unknown): boolean {
  const properties = (schema && typeof schema === 'object' ? (schema as { properties?: unknown }).properties : null) ?? {};
  return typeof properties === 'object' && !('status' in (properties as object));
}

/**
 * Whether a type's records are things owed, and so carry their verbs where
 * they are read: the row lifecycle, and `x-owed: true` on the type's schema.
 * @param schema - The type's JSON Schema, or null.
 */
export function offersOwedVerbs(schema: unknown): boolean {
  return Boolean(schema) && typeof schema === 'object' && hasRowLifecycle(schema) && (schema as Record<string, unknown>)['x-owed'] === true;
}

/**
 * The states a record is still owed in: its verbs are Do it, Done and Drop.
 * `approved` is a candidate a person stood behind (`USABLE_RECORD_STATUSES`).
 */
const OWED: ReadonlySet<string> = new Set(['', 'open', 'active', 'approved']);

/** A proposal waiting for a person's judgment: its verbs are Approve and Dismiss, its Review decision. */
export const CANDIDATE = 'candidate';

/**
 * Whether a row status means the record is still owed. Any other state that
 * is not finished — a `candidate` waiting for a person's judgment, a
 * `rejected` one — has its own path (Review) and offers no verbs here.
 * @param status - The row's status (null reads as open).
 */
export function isOwedStatus(status: string | null | undefined): boolean {
  return OWED.has(String(status ?? '').toLowerCase());
}

/**
 * Whether a row status means the record is finished.
 * @param status - The row's status (null reads as open).
 */
export function isFinishedStatus(status: string | null | undefined): boolean {
  return FINISHED.has(String(status ?? '').toLowerCase());
}

/**
 * A finished state as a person reads it.
 * @param status
 */
export function finishedLabel(status: string): string {
  return status === 'dropped' ? 'Dropped' : status === 'archived' ? 'Archived' : status === 'closed' ? 'Closed' : 'Done';
}

/**
 * The record's own lifecycle in words, for an agent reading it beside the
 * type's fields — so a field that sounds like a status (`relationship_status:
 * to contact`) is never read as the record's. 2026-10-23: an answer called
 * three follow-ups "to contact" when all three were still proposals waiting
 * in Review, and the person could not find a way to act on them.
 * @param status - The row's status (null reads as open).
 */
export function recordStateLine(status: string | null | undefined): string {
  const s = String(status ?? '').toLowerCase();
  if (s === CANDIDATE) {
    return 'proposed: waiting for a person to approve or dismiss it in Review; not yet a record they stand behind';
  }
  if (s === 'rejected') {
    return 'dismissed in Review: a proposal a person turned down';
  }
  if (isFinishedStatus(s)) {
    return `finished (${finishedLabel(s).toLowerCase()})`;
  }
  return isOwedStatus(s) ? 'open' : s;
}
