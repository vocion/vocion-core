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
