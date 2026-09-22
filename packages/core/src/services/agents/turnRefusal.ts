/**
 * A turn the workspace declined to run (#114).
 *
 * There is a real difference between "the answer broke" and "we never started
 * one". A budget that has been spent, an agent that is not allowed to answer —
 * nothing went wrong in the run, there is no half-answer to show, and asking
 * again changes nothing until someone changes a setting. Persisted as
 * `refused` rather than `failed`, so the person reads what to do about it
 * instead of "the answer stopped partway through".
 *
 * Thrown rather than returned because it ends the turn from deep inside the
 * runtime, on the same path as any other failure — the type is how the SSE
 * route tells the two apart without matching on message text.
 */
export class TurnRefusedError extends Error {
  /** What the person can do about it, if anything — carried into `status_reason`. */
  override readonly name = 'TurnRefusedError';

  constructor(message: string) {
    super(message);
  }
}

/**
 * Was this turn declined rather than broken?
 * @param error - Whatever ended the turn.
 * @returns True when the workspace refused to run it.
 */
export function isTurnRefusal(error: unknown): boolean {
  // The name check carries the answer across a module boundary that `instanceof`
  // cannot: the runtime provider re-throws errors it rebuilt from a container's
  // JSON, and a rebuilt error is a different class with the same name.
  return error instanceof TurnRefusedError || (error instanceof Error && error.name === 'TurnRefusedError');
}
