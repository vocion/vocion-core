import type { PageRow } from './pageFields';
import { describe, expect, it } from 'vitest';
import { hoursLive, measureLine, measureLines, outcomeLine } from './releaseOutcome';

/**
 * Shipping is not the end of the loop.
 *
 * `healthAfter` says the deploy worked; this says the CHANGE worked, which is
 * a later and different question. Nothing fills it yet, which is exactly why
 * the absence has to be drawn — a missing capability that shows as a silence
 * is one nobody ever fixes.
 */

const NOW = new Date('2026-09-22T12:00:00Z');

function release(id: number, hoursAgo: number | null, outcome?: Record<string, unknown>): PageRow {
  return {
    id,
    title: `v${id}`,
    status: null,
    createdAt: NOW,
    meta: {
      ...(hoursAgo === null ? {} : { releasedAt: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString() }),
      ...(outcome ? { outcome } : {}),
    },
  };
}

describe('what production said about a release', () => {
  it('is watching while the release is too young to judge', () => {
    expect(outcomeLine(release(1, 2), NOW)).toBe('watching');
    expect(outcomeLine(release(2, 23), NOW)).toBe('watching');
  });

  it('says nobody looked once it is old enough to have an answer', () => {
    // The point of the whole field: a release that has been live a day with
    // no reading is a gap in the loop, not a silence.
    expect(outcomeLine(release(3, 25), NOW)).toBe('outcome not checked');
    expect(outcomeLine(release(4, 240), NOW)).toBe('outcome not checked');
  });

  it('says the verdict once somebody looked, however young the release', () => {
    expect(outcomeLine(release(5, 2, { verdict: 'validated' }), NOW)).toBe('validated');
    expect(outcomeLine(release(6, 100, { verdict: 'regressed' }), NOW)).toBe('regressed');
    // Inconclusive is an honest answer, not a failure to answer.
    expect(outcomeLine(release(7, 100, { verdict: 'inconclusive' }), NOW)).toBe('inconclusive');
  });

  it('claims nothing about a release with no date to measure from', () => {
    // "Not checked" would be a claim about a clock we do not have.
    expect(outcomeLine(release(8, null), NOW)).toBeNull();
    expect(hoursLive(release(8, null), NOW)).toBeNull();
  });
});

describe('a measure stated against what it was before', () => {
  it('reads as a movement, not as a number', () => {
    // "share completion 76%" says nothing; "91% → 76%" says the release broke
    // something.
    expect(measureLine({ label: 'share completion', before: 91, after: 76, unit: '%', goodWhen: 'up' }))
      .toBe('share completion 91% → 76% ↓ — worse');
  });

  it('does not call a move worse when it is the good direction', () => {
    expect(measureLine({ label: 'errors', before: 40, after: 12, unit: '', goodWhen: 'down' }))
      .toBe('errors 40 → 12 ↓');
    expect(measureLine({ label: 'signups', before: 10, after: 18, goodWhen: 'up' }))
      .toBe('signups 10 → 18 ↑');
  });

  it('judges nothing when the page did not say which way is good', () => {
    expect(measureLine({ label: 'requests', before: 10, after: 18 })).toBe('requests 10 → 18 ↑');
  });

  it('says a measure with no baseline is unreadable rather than flat', () => {
    // Quietly rendering it as a bare number is how a regression hides.
    expect(measureLine({ label: 'MAU', after: 1284 })).toBe('MAU 1284 — nothing to compare against');
  });

  it('says so when nothing was read at all', () => {
    expect(measureLine({ label: 'MAU' })).toBe('MAU not read');
  });

  it('calls an unchanged measure unchanged', () => {
    expect(measureLine({ label: 'errors', before: 3, after: 3 })).toBe('errors unchanged at 3');
  });

  it('draws every measure a release carries', () => {
    const r = release(9, 30, {
      verdict: 'regressed',
      measures: [
        { label: 'errors', before: 2, after: 2 },
        { label: 'share completion', before: 91, after: 76, unit: '%', goodWhen: 'up' },
      ],
    });

    expect(measureLines(r)).toEqual([
      'errors unchanged at 2',
      'share completion 91% → 76% ↓ — worse',
    ]);
  });
});
