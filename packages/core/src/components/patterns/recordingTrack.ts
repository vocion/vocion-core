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
 * The stretch of the recording the track shows. The whole recording when its marks are spread
 * over it; when they sit in one part of it (an automation taught from the first minute of a
 * ten-minute recording), that part with a little room either side, so the marks can be told apart.
 * @param marks - The marks.
 * @param durationSec - The recording's length, when known.
 */
export function trackWindow(marks: RecordingMark[], durationSec: number | null | undefined): { from: number; to: number } {
  const length = trackLength(marks, durationSec);
  const at = marks.map(m => m.at).filter(t => Number.isFinite(t) && t >= 0 && t <= length);
  if (at.length < 2) {
    return { from: 0, to: length };
  }
  const first = Math.min(...at);
  const last = Math.max(...at);
  if (last - first >= length / 2 || last === first) {
    return { from: 0, to: length };
  }
  const room = Math.max(2, (last - first) * 0.06);
  return { from: Math.max(0, Math.floor(first - room)), to: Math.min(length, Math.ceil(last + room)) };
}

/**
 * The lanes that have marks, in the order given, each mark with its place on the track as a
 * percentage from the left (0–100) of the stretch the track shows. A lane with no marks is left out: no empty rows.
 * @param marks - The marks.
 * @param lanes - Every kind of lane, in the order they are drawn.
 * @param durationSec - The recording's length, when known.
 */
export function placeMarks(marks: RecordingMark[], lanes: RecordingLane[], durationSec: number | null | undefined): PlacedLane[] {
  const { from, to } = trackWindow(marks, durationSec);
  return lanes
    .map(lane => ({
      ...lane,
      marks: marks
        .filter(m => m.kind === lane.kind && Number.isFinite(m.at) && m.at >= 0)
        .sort((a, b) => a.at - b.at)
        .map(m => ({ ...m, left: Math.min(100, Math.max(0, ((m.at - from) / (to - from)) * 100)) })),
    }))
    .filter(lane => lane.marks.length > 0);
}
