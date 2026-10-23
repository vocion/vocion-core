/**
 * What makes two captures one meeting — pure, with no database behind it, so
 * the job and the card read it without loading the capture store.
 */

/** A start is bucketed to this, so two captures of one call agree on it. */
const START_BUCKET_MS = 30 * 60_000;

/**
 * What makes two captures one meeting — a recording and a note of the same
 * call: its owner and its start, to the half hour. A capture with neither is
 * its own meeting. Pure.
 * @param capture - The capture.
 * @param capture.documentId - Its document.
 * @param capture.owner - Its owner.
 * @param capture.start - Its start.
 */
export function meetingKey(capture: { documentId: number; owner: string | null; start: string | null }): string {
  const at = capture.start ? Date.parse(capture.start) : Number.NaN;
  if (!capture.owner || Number.isNaN(at)) {
    return `doc:${capture.documentId}`;
  }
  return `${capture.owner}:${new Date(Math.floor(at / START_BUCKET_MS) * START_BUCKET_MS).toISOString()}`;
}
