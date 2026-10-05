/**
 * THE STATES THAT END A REQUEST — one list, read by every factory step (the
 * carry and the sweep, and dispatch's reopen). Two copies drift.
 */

/** A request in one of these is done: nothing carries it on. */
export const CLOSED_REQUEST_STATES: ReadonlySet<string> = new Set(['deferred', 'answered', 'out_of_scope', 'shipped']);

/** Closed by a verdict (not by shipping): a person's Build reopens it. */
export const REOPENABLE_REQUEST_STATES: ReadonlySet<string> = new Set([...CLOSED_REQUEST_STATES].filter(s => s !== 'shipped'));

/** The state a reopened request is put back in: in the work, approved to build. */
export const OPEN_REQUEST_STATE = 'in_scope';

/**
 * THE ONE WAY A REQUEST IS REOPENED: the fields every reopen writes, so an automatic step after
 * the ship (the live check's send-back, FE-457, 2026-10-05) reads as open exactly as a person's
 * Build does. `settledReason` reads the type's settled field (`state`) and `reopenedAt`; a reopen
 * that stamps only the time stays settled and every automatic start after it is refused.
 * @param by - Who reopened it: a person's id, or the step's name.
 * @param at - When, ISO.
 */
export function reopenedFields(by: string, at: string): { state: string; recommendationState: string; reopenedAt: string; reopenedBy: string } {
  return { state: OPEN_REQUEST_STATE, recommendationState: 'approved', reopenedAt: at, reopenedBy: by };
}

/**
 * The state a request closes in when what it reported resolved itself, with
 * nothing built (an environment healthy again). One of the closed states.
 */
export const RESOLVED_REQUEST_STATE = 'answered';

/** A type's `x-settled` descriptor: the field that settles a record and the values that do. */
export type SettledDescriptor = { field: string; in: readonly string[] };

/**
 * WHETHER A REQUEST HAS SETTLED, and the clause that says why — or null while
 * it is open. Shipping settles it (`shippedAt`, written by the release pack)
 * whatever its state field reads afterwards, until a person reopens it with a
 * later Build (`reopenedAt`). Otherwise the request type's own `x-settled`
 * says which values of which field end it; a type that declares none falls
 * back to {@link CLOSED_REQUEST_STATES}. No state is named here.
 *
 * Every automatic step reads this before it acts (request 224, 2026-10-02: a
 * late QA verdict on a superseded attempt started a fourth build eleven
 * minutes after the feature shipped, and wrote `state: building` over it).
 * @param request - The request.
 * @param request.meta - Its metadata.
 * @param request.status - Its status column, for a descriptor that names `status`.
 * @param request.settled - Its type's `x-settled`, when read.
 */
export function settledReason(request: { meta: Record<string, unknown>; status?: string | null; settled?: SettledDescriptor | null }): string | null {
  const meta = request.meta ?? {};
  const shippedAt = typeof meta.shippedAt === 'string' && meta.shippedAt ? meta.shippedAt : null;
  const reopenedAt = typeof meta.reopenedAt === 'string' && meta.reopenedAt ? meta.reopenedAt : null;
  if (shippedAt && !(reopenedAt && Date.parse(reopenedAt) > Date.parse(shippedAt))) {
    const release = meta.shippedIn !== undefined && meta.shippedIn !== null && String(meta.shippedIn) ? ` in release #${String(meta.shippedIn)}` : '';
    return `it shipped${release}`;
  }
  const d = request.settled;
  if (d) {
    const raw = meta[d.field] ?? (d.field === 'status' ? request.status : undefined);
    return typeof raw === 'string' && d.in.includes(raw) ? `it is ${raw.replace(/_/g, ' ')}` : null;
  }
  const state = typeof meta.state === 'string' ? meta.state : '';
  return CLOSED_REQUEST_STATES.has(state) ? `it is ${state.replace(/_/g, ' ')}` : null;
}
