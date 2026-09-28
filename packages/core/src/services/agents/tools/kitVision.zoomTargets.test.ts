/**
 * The zoomed re-count is capped per photo (vocion-core#280).
 *
 * Every region the full-frame pass could not count used to get its own
 * cropped vision call, so a blurry or crowded photo decided how many paid
 * model calls one `vision_compare_reference` made. `selectZoomTargets` is
 * the pure half of that loop: it picks which regions get a crop.
 */
import { describe, expect, it } from 'vitest';
import { MAX_ZOOM_CROPS, selectZoomTargets } from './kitVision';

type TestFinding = Parameters<typeof selectZoomTargets>[0][number];

function finding(over: Partial<TestFinding> = {}): TestFinding {
  return { region: 'QTY=4', issue: 'count', severity: 'minor', confidence: 0.5, box: [0.1, 0.1, 0.1, 0.1], ...over };
}

describe('selectZoomTargets', () => {
  it('crops at most the cap from a photo that flags forty regions, and says how many it skipped', () => {
    const findings = Array.from({ length: 40 }, (_, n) => finding({ region: `box ${n}` }));

    const { targets, skipped } = selectZoomTargets(findings);

    expect(targets).toHaveLength(MAX_ZOOM_CROPS);
    expect(skipped).toBe(40 - MAX_ZOOM_CROPS);
  });

  it('zooms the blocking regions first, then the ones the model was least sure of', () => {
    const findings = [
      finding({ region: 'minor, sure', confidence: 0.9 }),
      finding({ region: 'minor, unsure', confidence: 0.2 }),
      finding({ region: 'blocking', severity: 'blocking', confidence: 0.9 }),
    ];

    const { targets } = selectZoomTargets(findings, 2);

    expect(targets.map(t => t.f.region)).toEqual(['blocking', 'minor, unsure']);
    // Each target keeps its place in the original list, which is where its correction is written back.
    expect(targets.map(t => t.i)).toEqual([2, 1]);
  });

  it('only zooms regions the model could not count and that say where to look', () => {
    const findings = [
      finding({ issue: 'missing' }),
      finding({ issue: 'unreadable', box: undefined }),
      finding({ issue: 'unreadable' }),
    ];

    const { targets, skipped } = selectZoomTargets(findings);

    expect(targets.map(t => t.i)).toEqual([2]);
    expect(skipped).toBe(0);
  });

  it('selects nothing for a photo with no flagged regions, so no vision call is made', () => {
    expect(selectZoomTargets([finding({ issue: 'missing' })])).toEqual({ targets: [], skipped: 0 });
  });
});
