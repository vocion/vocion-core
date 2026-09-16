/**
 * What the dataset card claims about the last run.
 *
 * Every rule here is one someone could get wrong by writing the obvious code:
 * showing the newest run's pass rate (blanks out while a run is in flight),
 * or a date with no status (a failed attempt reads as a healthy dataset), or
 * a zero for a dataset nobody has ever run.
 */
import { describe, expect, it } from 'vitest';
import { summariseLastRun, timeAgo } from './lastRun';

const NOW = Date.parse('2026-09-16T12:00:00Z');

function run(status: string, startedAt: string, passRate?: number) {
  return { status, startedAt: new Date(startedAt), metrics: passRate === undefined ? null : { passRate } };
}

describe('summariseLastRun', () => {
  it('says nobody has run it, rather than showing a zero', () => {
    const summary = summariseLastRun([], NOW);

    expect(summary.text).toBe('never run');
    expect(summary.passRate).toBeNull();
    expect(summary.exactTime).toBeNull();
  });

  it('keeps yesterday\'s pass rate visible while a new run is going', () => {
    const summary = summariseLastRun(
      [run('running', '2026-09-16T11:59:00Z'), run('succeeded', '2026-09-15T12:00:00Z', 0.9)],
      NOW,
    );

    expect(summary.text).toBe('running now');
    // The number someone had yesterday does not disappear because a new run
    // started; it is still the last thing we actually measured.
    expect(summary.passRate).toBe(0.9);
  });

  it('says the last attempt failed instead of dating it quietly', () => {
    const summary = summariseLastRun(
      [run('failed', '2026-09-14T12:00:00Z'), run('succeeded', '2026-09-13T12:00:00Z', 0.8)],
      NOW,
    );

    expect(summary.text).toBe('last run failed 2 days ago');
    expect(summary.warning).toBe(true);
  });

  it('dates a healthy dataset from its newest run', () => {
    const summary = summariseLastRun(
      [run('succeeded', '2026-09-16T09:00:00Z', 0.75), run('succeeded', '2026-09-10T12:00:00Z', 0.5)],
      NOW,
    );

    expect(summary.text).toBe('last run 3 hours ago');
    expect(summary.warning).toBe(false);
    expect(summary.passRate).toBe(0.75);
  });

  it('carries the exact time for the hover, since the card only shows a rough one', () => {
    const summary = summariseLastRun([run('succeeded', '2026-09-16T09:00:00Z', 0.75)], NOW);

    expect(summary.exactTime).toBe(new Date('2026-09-16T09:00:00Z').toLocaleString());
  });
});

describe('timeAgo', () => {
  it('reads in the units the gap deserves', () => {
    expect(timeAgo(new Date(NOW - 30_000), NOW)).toBe('just now');
    expect(timeAgo(new Date(NOW - 5 * 60_000), NOW)).toBe('5 minutes ago');
    expect(timeAgo(new Date(NOW - 60 * 60_000), NOW)).toBe('1 hour ago');
    expect(timeAgo(new Date(NOW - 48 * 60 * 60_000), NOW)).toBe('2 days ago');
  });

  it('gives a real date once "N days ago" stops meaning anything', () => {
    // Three weeks back, nobody counts days — and "21 days ago" hides that this
    // dataset has not been measured since before the last release.
    expect(timeAgo(new Date(NOW - 21 * 24 * 60 * 60_000), NOW)).toContain('on ');
  });
});
