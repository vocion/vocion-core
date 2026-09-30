/**
 * THE STATES THAT END A REQUEST — one list, read by every factory step (the
 * carry and the sweep, and dispatch's reopen). Two copies drift.
 */

/** A request in one of these is done: nothing carries it on. */
export const CLOSED_REQUEST_STATES: ReadonlySet<string> = new Set(['deferred', 'answered', 'out_of_scope', 'shipped']);

/** Closed by a verdict (not by shipping): a person's Build reopens it. */
export const REOPENABLE_REQUEST_STATES: ReadonlySet<string> = new Set([...CLOSED_REQUEST_STATES].filter(s => s !== 'shipped'));
