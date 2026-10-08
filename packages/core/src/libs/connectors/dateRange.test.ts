import { describe, expect, it } from 'vitest';
import { rangeFrom } from './dateRange';

describe('the range a family read takes', () => {
  const now = new Date('2026-10-08T15:00:00Z');

  it('defaults to the 30 days ending yesterday', () => {
    expect(rangeFrom({}, now)).toEqual({ from: '2026-09-08', to: '2026-10-07' });
  });

  it('counts back 30 days from a given end', () => {
    expect(rangeFrom({ to: '2026-09-30' }, now)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('keeps a range it is given', () => {
    expect(rangeFrom({ from: '2026-07-01', to: '2026-07-31' }, now)).toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });

  it('refuses a backwards range, a malformed day and a range longer than a year', () => {
    expect(() => rangeFrom({ from: '2026-08-02', to: '2026-08-01' }, now)).toThrow(/after/);
    expect(() => rangeFrom({ from: 'last week' }, now)).toThrow(/YYYY-MM-DD/);
    expect(() => rangeFrom({ from: '2024-01-01', to: '2026-01-01' }, now)).toThrow(/longer than 366 days/);
  });
});
