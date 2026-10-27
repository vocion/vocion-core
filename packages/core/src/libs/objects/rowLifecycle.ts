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
 * @param snoozedUntil - The date an open record is put off to, if any; one that has passed is over.
 * @param now - The clock.
 * @param decision
 */
export function recordStateLine(status: string | null | undefined, snoozedUntil?: Date | null, now: number = Date.now(), decision?: unknown): string {
  const s = String(status ?? '').toLowerCase();
  if (s === CANDIDATE) {
    return 'proposed: waiting for a person to approve or dismiss it in Review; not yet a record they stand behind';
  }
  if (s === 'rejected') {
    return turnedDownLine(readRecordDecision(decision));
  }
  if (isFinishedStatus(s)) {
    return `finished (${finishedLabel(s).toLowerCase()})`;
  }
  if (!isOwedStatus(s)) {
    return s;
  }
  return snoozedUntil && snoozedUntil.getTime() > now
    ? `open, snoozed until ${snoozedUntil.toISOString().slice(0, 10)}: put off by a person; do not raise it before then`
    : 'open';
}

/**
 * Who settled a proposed record, as `decideCandidateObject` stamps it on the
 * record's provenance (`provenance.decision`).
 */
export type RecordDecision = {
  status: string;
  /** The run's `decidedBy`: a person's id, or a machine's stamp (`libs/actions/decider.ts`). */
  by: string | null;
  /** True when a machine settled it: a seat withdrawing its own card, a clock's default, a sweep. */
  byMachine: boolean;
  at: string;
  /** The reason the decider gave, when one was given. */
  note?: string | null;
};

/**
 * A record's decision stamp, or null when it carries none (records decided
 * before the stamp existed).
 * @param raw - `provenance.decision`.
 */
export function readRecordDecision(raw: unknown): RecordDecision | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const d = raw as Record<string, unknown>;
  if (typeof d.status !== 'string' || typeof d.at !== 'string') {
    return null;
  }
  return { status: d.status, by: typeof d.by === 'string' ? d.by : null, byMachine: d.byMachine === true, at: d.at, note: typeof d.note === 'string' ? d.note : null };
}

/**
 * A turned-down proposal in words, saying WHO turned it down.
 *
 * Jamie, 2026-10-27, of four repo records in a factory workspace the product manager
 * called "turned down in Review": "i never deny'd the repos in [the workspace].
 * i approved all." This line used to say "a proposal a person turned down" of
 * every rejected record, while the same status is written when a seat
 * withdraws its own card, a decision clock declines it by default, or a
 * sweep closes a moot one. Now it says who, from the record's own stamp, and
 * a record with no stamp says it does not know rather than blaming a person.
 * @param d - The record's decision stamp.
 */
function turnedDownLine(d: RecordDecision | null): string {
  const why = d?.note ? ` (${d.note.slice(0, 160)})` : '';
  if (!d) {
    return 'not in use: its proposal was closed in Review — by a person, or withdrawn by an agent or a sweep (this record predates the stamp that says which). File it again for a person to approve if it is still wanted';
  }
  if (d.byMachine) {
    const who = d.by === 'by-default' ? 'its decision clock, by default at the deadline' : d.by ?? 'the system';
    return `withdrawn, not turned down by a person: ${who} closed this proposal on ${d.at.slice(0, 10)}${why}. File it again for a person to approve if it is still wanted`;
  }
  return `dismissed in Review: ${d.by ?? 'a person'} turned this proposal down on ${d.at.slice(0, 10)}${why}`;
}
