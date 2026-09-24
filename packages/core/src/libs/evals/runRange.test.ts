/**
 * Reading a run period from a URL or an API call.
 *
 * The rule that matters is the one a caller cannot check for themselves: a
 * range that does not parse is refused, never widened to "all time", because
 * an unfiltered list that looks filtered is indistinguishable from a right one.
 */
import { describe, expect, it } from 'vitest';
import { parseRunRange } from './runRange';

describe('parseRunRange', () => {
  it('reads a bare date as midnight UTC, not midnight wherever the server runs', () => {
    const result = parseRunRange({ from: '2026-09-01', to: '2026-09-08' });

    expect(result).toEqual({ ok: true, range: { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-08T00:00:00Z') } });
  });

  it('keeps the offset a full timestamp carries', () => {
    const result = parseRunRange({ from: '2026-09-01T00:00:00-07:00' });

    expect(result.ok && result.range.from?.toISOString()).toBe('2026-09-01T07:00:00.000Z');
  });

  it('treats missing ends as open, so no range at all is all time', () => {
    expect(parseRunRange({})).toEqual({ ok: true, range: { from: undefined, to: undefined } });
    expect(parseRunRange({ from: null, to: '' })).toEqual({ ok: true, range: { from: undefined, to: undefined } });
  });

  it('refuses a timestamp with no offset rather than guessing its timezone', () => {
    const result = parseRunRange({ from: '2026-09-01T00:00:00' });

    expect(result.ok).toBe(false);
  });

  it('refuses a date that does not exist instead of rolling it into the next month', () => {
    const result = parseRunRange({ to: '2026-02-31' });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain('`to`');
  });

  it('refuses a range that ends before or when it starts', () => {
    expect(parseRunRange({ from: '2026-09-08', to: '2026-09-01' }).ok).toBe(false);
    expect(parseRunRange({ from: '2026-09-08', to: '2026-09-08' }).ok).toBe(false);
  });

  it('refuses a closed range longer than a year, the usual sign of a mistyped year', () => {
    const result = parseRunRange({ from: '2025-09-01', to: '2026-09-03' });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain('366 days');
  });

  it('accepts a full leap year, and an hour over for a daylight-saving change', () => {
    expect(parseRunRange({ from: '2028-01-01', to: '2029-01-01' }).ok).toBe(true);
    expect(parseRunRange({ from: '2028-01-01T00:00:00Z', to: '2029-01-01T01:00:00Z' }).ok).toBe(true);
  });

  it('holds only a closed range to the limit, so "since" and "before" still reach every run', () => {
    expect(parseRunRange({ from: '2020-01-01' }).ok).toBe(true);
    expect(parseRunRange({ to: '2026-09-01' }).ok).toBe(true);
  });

  it('refuses words where a date should be', () => {
    const result = parseRunRange({ from: 'last-week' });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain('`from`');
  });
});
