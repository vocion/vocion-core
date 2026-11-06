/**
 * Where a recording's marks sit on its track — the layout `RecordingTimeline`
 * draws, kept pure so it can be checked without a browser.
 */

/** A moment on a recording worth marking: what it is (`kind`, one lane each), when, and its words. */
export type RecordingMark = { id: string; kind: string; at: number; label: string };

/** A lane of the track: one kind of mark, with the name a person reads beside it. */
export type RecordingLane = { kind: string; label: string; /** The mark's look in this lane (a token colour, a shape). */ className?: string };

export type PlacedLane = RecordingLane & { marks: Array<RecordingMark & { left: number }> };

/**
 * The track's length: the recording's own when known, else a little past the last mark.
 * @param marks - The marks.
 * @param durationSec - The recording's length, when known.
 */
export function trackLength(marks: RecordingMark[], durationSec: number | null | undefined): number {
  if (durationSec && Number.isFinite(durationSec) && durationSec > 0) {
    return durationSec;
  }
  const last = marks.reduce((m, x) => Math.max(m, x.at), 0);
  return last > 0 ? last * 1.05 : 60;
}

/**
 * The lanes that have marks, in the order given, each mark with its place on the track as a
 * percentage from the left (0–100). A lane with no marks is left out: no empty rows.
 * @param marks - The marks.
 * @param lanes - Every kind of lane, in the order they are drawn.
 * @param durationSec - The recording's length, when known.
 */
export function placeMarks(marks: RecordingMark[], lanes: RecordingLane[], durationSec: number | null | undefined): PlacedLane[] {
  const length = trackLength(marks, durationSec);
  return lanes
    .map(lane => ({
      ...lane,
      marks: marks
        .filter(m => m.kind === lane.kind && Number.isFinite(m.at) && m.at >= 0)
        .sort((a, b) => a.at - b.at)
        .map(m => ({ ...m, left: Math.min(100, Math.max(0, (m.at / length) * 100)) })),
    }))
    .filter(lane => lane.marks.length > 0);
}
