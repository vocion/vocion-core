/**
 * The ledger's third dimension. These are the numbers the header reports and
 * the Disagreements filter selects, so they are worth pinning down.
 */
import { describe, expect, it } from 'vitest';
import { calibrationOf, dispositionOf, isDisagreement, versionDelta } from './disposition';

describe('dispositionOf', () => {
  it('is Pending when nobody has decided', () => {
    expect(dispositionOf({ reviewStatus: null, decision: null, agreed: null })).toBe('pending');
    expect(dispositionOf({ reviewStatus: 'pending', decision: null, agreed: null })).toBe('pending');
  });

  it('is Accepted when the person went with the recommendation', () => {
    expect(dispositionOf({ reviewStatus: 'approved', decision: 'approved', agreed: true })).toBe('accepted');
    expect(dispositionOf({ reviewStatus: 'done', decision: null, agreed: null })).toBe('accepted');
  });

  it('is Corrected when the person overrode it — declined, or edited before approving', () => {
    expect(dispositionOf({ reviewStatus: 'rejected', decision: 'rejected', agreed: false })).toBe('corrected');
    expect(dispositionOf({ reviewStatus: 'approved', decision: 'edited', agreed: false })).toBe('corrected');
    // An approval that disagreed with the recommendation is still a correction.
    expect(dispositionOf({ reviewStatus: 'approved', decision: 'approved', agreed: false })).toBe('corrected');
  });

  it('is Dismissed when the row left the queue without a judgement', () => {
    // Counting these as corrections would understate the agreement rate.
    expect(dispositionOf({ reviewStatus: 'cancelled', decision: null, agreed: null })).toBe('dismissed');
    expect(dispositionOf({ reviewStatus: 'superseded', decision: null, agreed: null })).toBe('dismissed');
    expect(isDisagreement(dispositionOf({ reviewStatus: 'cancelled', decision: null, agreed: null }))).toBe(false);
  });
});

describe('calibrationOf', () => {
  it('produces the header line: assessed · need review · corrected · agreement', () => {
    const rows = [
      ...Array.from({ length: 36 }, () => ({ assessed: true, disposition: 'accepted' as const })),
      ...Array.from({ length: 5 }, () => ({ assessed: true, disposition: 'corrected' as const })),
      ...Array.from({ length: 4 }, () => ({ assessed: true, disposition: 'pending' as const })),
      ...Array.from({ length: 2 }, () => ({ assessed: true, disposition: 'dismissed' as const })),
    ];

    const c = calibrationOf(rows);

    expect(c).toMatchObject({ assessed: 47, needReview: 4, corrected: 5, accepted: 36, decided: 41 });
    expect(Math.round(c.agreementRate! * 100)).toBe(88);
  });

  it('counts only ASSESSED rows as needing review — a call with no transcript waits on a transcript', () => {
    const c = calibrationOf([
      { assessed: true, disposition: 'pending' },
      { assessed: false, disposition: 'pending' },
    ]);

    expect(c).toMatchObject({ assessed: 1, needReview: 1 });
  });

  it('reports no rate rather than 100% when nothing has been decided', () => {
    expect(calibrationOf([{ assessed: true, disposition: 'pending' }]).agreementRate).toBeNull();
  });
});

describe('versionDelta', () => {
  const row = (v: string, disposition: 'accepted' | 'corrected', at: string) => ({ classifierVersion: v, disposition, assessedAt: at });

  it('compares the current classifier version against the most recent earlier one', () => {
    const rows = [
      row('m#discovery-v2', 'accepted', '2026-09-16T00:00:00Z'),
      row('m#discovery-v2', 'accepted', '2026-09-16T01:00:00Z'),
      row('m#discovery-v2', 'accepted', '2026-09-16T02:00:00Z'),
      row('m#discovery-v2', 'corrected', '2026-09-16T03:00:00Z'),
      row('m#discovery-v1', 'accepted', '2026-09-10T00:00:00Z'),
      row('m#discovery-v1', 'corrected', '2026-09-10T01:00:00Z'),
    ];

    // 75% vs 50% → +25 points.
    expect(versionDelta(rows, 'm#discovery-v2')).toEqual({ previousVersion: 'm#discovery-v1', points: 25 });
  });

  it('reports nothing rather than a baseline it invented', () => {
    expect(versionDelta([row('m#discovery-v2', 'accepted', '2026-09-16T00:00:00Z')], 'm#discovery-v2')).toBeNull();
    expect(versionDelta([], null)).toBeNull();
  });
});
