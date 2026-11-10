import { describe, expect, it } from 'vitest';
import { placeMarks, trackLength, trackWindow } from './recordingTrack';

const LANES = [{ kind: 'step', label: 'Steps' }, { kind: 'rule', label: 'Rules' }, { kind: 'question', label: 'Open questions' }];

describe('a recording\'s track', () => {
  it('places each mark at its share of the recording, one lane per kind that has marks', () => {
    const lanes = placeMarks([
      { id: 'b', kind: 'step', at: 50, label: 'Step 2' },
      { id: 'a', kind: 'step', at: 0, label: 'Step 1' },
      { id: 'r', kind: 'rule', at: 200, label: 'Rule' },
    ], LANES, 200);

    expect(lanes.map(l => l.kind)).toEqual(['step', 'rule']);
    expect(lanes[0]!.marks.map(m => [m.id, m.left])).toEqual([['a', 0], ['b', 25]]);
    expect(lanes[1]!.marks[0]!.left).toBe(100);
  });

  it('runs a little past the last mark when the recording\'s length is unknown', () => {
    expect(trackLength([{ id: 'a', kind: 'step', at: 100, label: '' }], null)).toBeCloseTo(105);
    expect(trackLength([], undefined)).toBe(60);
    expect(placeMarks([{ id: 'a', kind: 'step', at: 500, label: '' }], LANES, 100)[0]!.marks[0]!.left).toBe(100);
  });

  it('shows the part of a long recording its marks are in, so they can be told apart', () => {
    const marks = [0, 3, 9, 36, 44, 46].map((at, i) => ({ id: `s${i}`, kind: 'step', at, label: '' }));

    expect(trackWindow(marks, 596)).toEqual({ from: 0, to: 49 });
    expect(placeMarks(marks, LANES, 596)[0]!.marks.at(-1)!.left).toBeCloseTo((46 / 49) * 100);
    // Marks spread over the recording keep the whole of it.
    expect(trackWindow([{ id: 'a', kind: 'step', at: 10, label: '' }, { id: 'b', kind: 'step', at: 400, label: '' }], 596)).toEqual({ from: 0, to: 596 });
    expect(trackWindow([{ id: 'a', kind: 'step', at: 300, label: '' }, { id: 'b', kind: 'step', at: 360, label: '' }], 596)).toEqual({ from: 296, to: 364 });
  });
});
