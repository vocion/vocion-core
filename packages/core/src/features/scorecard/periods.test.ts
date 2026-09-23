import { describe, expect, it } from 'vitest';
import { customRange, describeRange, parseDateInput, rangeForPreset } from './periods';

// Local time on purpose: the presets are the viewer's own days.
const NOW = new Date(2026, 8, 23, 15, 30); // Wed Sep 23 2026, 15:30 local

describe('rangeForPreset', () => {
  it('makes "Last 7 days" today plus the six days before, ending at tonight\'s midnight', () => {
    expect(rangeForPreset('last7', NOW)).toEqual({ from: new Date(2026, 8, 17), to: new Date(2026, 8, 24) });
  });

  it('makes "Last 14 days" and "Last 30 days" the same shape', () => {
    expect(rangeForPreset('last14', NOW).from).toEqual(new Date(2026, 8, 10));
    expect(rangeForPreset('last30', NOW).from).toEqual(new Date(2026, 7, 25));
  });

  it('makes "This month" start on the 1st and include today', () => {
    expect(rangeForPreset('thisMonth', NOW)).toEqual({ from: new Date(2026, 8, 1), to: new Date(2026, 8, 24) });
  });

  it('makes "Last month" the whole previous month and nothing of this one', () => {
    expect(rangeForPreset('lastMonth', NOW)).toEqual({ from: new Date(2026, 7, 1), to: new Date(2026, 8, 1) });
  });

  it('rolls "Last month" back across a year boundary in January', () => {
    expect(rangeForPreset('lastMonth', new Date(2027, 0, 5))).toEqual({ from: new Date(2026, 11, 1), to: new Date(2027, 0, 1) });
  });

  it('makes "Year to date" start on January 1st', () => {
    expect(rangeForPreset('yearToDate', NOW).from).toEqual(new Date(2026, 0, 1));
  });
});

describe('customRange', () => {
  it('includes the last day picked, ending at the midnight after it', () => {
    expect(customRange('2026-09-01', '2026-09-10', 366)).toEqual({ ok: true, range: { from: new Date(2026, 8, 1), to: new Date(2026, 8, 11) } });
  });

  it('accepts a single day', () => {
    expect(customRange('2026-09-10', '2026-09-10', 366)).toEqual({ ok: true, range: { from: new Date(2026, 8, 10), to: new Date(2026, 8, 11) } });
  });

  it('refuses an end date before the start date', () => {
    expect(customRange('2026-09-10', '2026-09-01', 366)).toMatchObject({ ok: false });
  });

  it('refuses an empty or impossible date instead of guessing', () => {
    expect(customRange('', '2026-09-01', 366)).toMatchObject({ ok: false });
    expect(parseDateInput('2026-02-31')).toBeNull();
  });

  it('refuses a period longer than the server allows', () => {
    expect(customRange('2025-01-01', '2026-09-01', 366)).toMatchObject({ ok: false });
    expect(customRange('2025-09-02', '2026-09-01', 366)).toMatchObject({ ok: true });
  });
});

describe('describeRange', () => {
  it('shows the last day included, not the exclusive midnight after it', () => {
    expect(describeRange({ from: new Date(2026, 8, 1), to: new Date(2026, 8, 24) })).toBe('Sep 1 – Sep 23, 2026');
  });

  it('shows both years when the range crosses one', () => {
    expect(describeRange({ from: new Date(2025, 11, 20), to: new Date(2026, 0, 6) })).toBe('Dec 20, 2025 – Jan 5, 2026');
  });

  it('shows a single day once', () => {
    expect(describeRange({ from: new Date(2026, 8, 10), to: new Date(2026, 8, 11) })).toBe('Sep 10, 2026');
  });
});
