/**
 * The "illusion of work" (Chris, 2026-09-15): a decision that lands in 30ms
 * reads as nothing having happened. Every submitting control on "Review queue"
 * — approve, decline, snooze, resume, adopt, the sheet's Submit and Next —
 * holds its pending state for at least this long, and exactly as long as the
 * server takes when that is longer. Nothing advances optimistically.
 */
export const MIN_PENDING_MS = 400;

/**
 * Resolve (or reject) with `work`, but never before `minMs` has passed.
 * @param work - The in-flight mutation.
 * @param minMs - The floor; defaults to {@link MIN_PENDING_MS}.
 * @param wait - Injectable sleeper, for tests.
 */
export async function withMinimumPending<T>(work: Promise<T>, minMs: number = MIN_PENDING_MS, wait: (ms: number) => Promise<void> = sleep): Promise<T> {
  const floor = wait(minMs);
  try {
    const result = await work;
    await floor;
    return result;
  } catch (err) {
    await floor;
    throw err;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
