import { describe, expect, it, vi } from 'vitest';

// AuthGuards pulls in next-auth, which does not import cleanly under vitest;
// the range check under test needs neither the session nor the database.
vi.mock('./AuthGuards', () => ({ guardAuth: vi.fn() }));
vi.mock('@/services/scorecard/ScorecardService', () => ({ getScorecard: vi.fn() }));

const { parseScorecardRange } = await import('./Scorecard');

describe('parseScorecardRange', () => {
  it('accepts a normal period', () => {
    expect(parseScorecardRange({ from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' })).toEqual({
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-10-01T00:00:00.000Z'),
    });
  });

  it('refuses a period that ends before or when it starts', () => {
    expect(() => parseScorecardRange({ from: '2026-09-10T00:00:00Z', to: '2026-09-01T00:00:00Z' })).toThrow();
    expect(() => parseScorecardRange({ from: '2026-09-10T00:00:00Z', to: '2026-09-10T00:00:00Z' })).toThrow();
  });

  it('refuses a period longer than 366 days, so one request cannot scan years of events', () => {
    expect(() => parseScorecardRange({ from: '2024-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' })).toThrow();
  });

  it('still accepts 366 whole local days that cross a daylight-saving change (one hour longer)', () => {
    expect(() => parseScorecardRange({ from: '2025-09-01T00:00:00-04:00', to: '2026-09-02T00:00:00-05:00' })).not.toThrow();
  });
});
