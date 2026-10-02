/**
 * A blocker goes stale when the record it waits on is decided (#130,
 * 2026-09-29). Every id and name is invented.
 */
import { describe, expect, it } from 'vitest';
import { blockerRefs, blockerResolution } from './blocker';

const prose = {
  what: 'The replanned plan cannot be filed: two planning runs wrote to review item #4068.',
  owner: 'dana@northwind.example',
  next: 'Decide the pending review item #4068 / approve plan 136, so a contract can be written.',
};

describe('what a blocker waits on', () => {
  it('reads the records its next names when it has no typed waitsOn', () => {
    expect(blockerRefs(prose)).toEqual([{ kind: 'plan', id: 136 }, { kind: 'action', id: 4068 }]);
  });

  it('prefers the typed waitsOn, and ignores what does not parse', () => {
    expect(blockerRefs({ ...prose, waitsOn: [{ kind: 'ask', id: 12 }, { kind: 'nope', id: 3 }, { kind: 'plan', id: -1 }] })).toEqual([{ kind: 'ask', id: 12 }]);
    expect(blockerRefs({ ...prose, waitsOn: { kind: 'plan', id: '9' } })).toEqual([{ kind: 'plan', id: 9 }]);
  });

  it('names nothing for a blocker that names no record, or none at all', () => {
    expect(blockerRefs({ what: 'The staging account is not connected', next: 'connect it' })).toEqual([]);
    expect(blockerRefs(null)).toEqual([]);
    expect(blockerRefs('blocked')).toEqual([]);
  });
});

describe('when the move was made', () => {
  it('is resolved once the plan it names is approved', () => {
    const r = blockerResolution(prose, { plans: [{ id: 136, status: 'approved', approvedAt: '2026-09-29T14:20:14Z' }], actions: [{ id: 4068, status: 'pending' }] });

    expect(r).toMatchObject({ ref: { kind: 'plan', id: 136 }, line: 'plan #136 was approved' });
    expect(r?.at?.toISOString()).toBe('2026-09-29T14:20:14.000Z');
  });

  it('holds while everything it names is still open', () => {
    expect(blockerResolution(prose, { plans: [{ id: 136, status: 'in_review', approvedAt: null }], actions: [{ id: 4068, status: 'pending' }] })).toBeNull();
  });

  it('holds when the records it names are not known, rather than guessing', () => {
    expect(blockerResolution(prose, {})).toBeNull();
  });

  it('is resolved by an answered ask and by a decided review item', () => {
    expect(blockerResolution({ what: 'x', waitsOn: [{ kind: 'ask', id: 12 }] }, { asks: [{ id: 12, status: 'approved', decidedAt: new Date('2026-09-29T10:00:00Z') }] })?.line).toBe('ASK-12 was answered');
    expect(blockerResolution({ what: 'x', next: 'decide review item #77' }, { actions: [{ id: 77, status: 'rejected', decidedAt: null }] })?.line).toBe('review item ACT-77 was decided');
  });

  it('ignores a decision made before the blocker was written', () => {
    const since = { ...prose, since: '2026-09-29T15:00:00Z' };

    expect(blockerResolution(since, { plans: [{ id: 136, status: 'approved', approvedAt: '2026-09-29T14:20:14Z' }] })).toBeNull();
    expect(blockerResolution(since, { plans: [{ id: 136, status: 'approved', approvedAt: '2026-09-29T15:20:00Z' }] })).not.toBeNull();
  });
});

describe('a blocker that names its records by code (libs/codes.ts)', () => {
  it('reads ASK-, ACT- and a plan\'s code from its next line', () => {
    expect(blockerRefs({ what: 'x', next: 'Answer ASK-12, decide ACT-77, then approve PL-136.' })).toEqual([
      { kind: 'ask', id: 12 },
      { kind: 'action', id: 77 },
      { kind: 'plan', id: 136 },
    ]);
  });
});
