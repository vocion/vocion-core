import { describe, expect, it } from 'vitest';
import { relativeLabel, timeAgo } from './timeAgo';

// `timeAgo` is the coarse reading (evals, proposals); `relativeLabel` is the
// fine end of the same one — for a heartbeat column, where "just now" would
// hide whether a worker is still alive, and for a lease that ends in minutes.

const NOW = Date.parse('2026-09-20T12:00:00Z');
const at = (secondsFromNow: number) => new Date(NOW + secondsFromNow * 1000);

describe('relativeLabel', () => {
  it('reads seconds, minutes, hours and days ago', () => {
    expect(relativeLabel(at(0), NOW)).toBe('0s ago');
    expect(relativeLabel(at(-12), NOW)).toBe('12s ago');
    expect(relativeLabel(at(-59), NOW)).toBe('59s ago');
    expect(relativeLabel(at(-180), NOW)).toBe('3m ago');
    expect(relativeLabel(at(-2 * 3600), NOW)).toBe('2h ago');
    expect(relativeLabel(at(-3 * 86400), NOW)).toBe('3d ago');
  });

  it('reads the future — a lease that has not run out yet', () => {
    expect(relativeLabel(at(45), NOW)).toBe('in 45s');
    expect(relativeLabel(at(4 * 60), NOW)).toBe('in 4m');
    expect(relativeLabel(at(2 * 86400), NOW)).toBe('in 2d');
  });

  it('falls back to the plain date past two weeks, like timeAgo', () => {
    const old = at(-20 * 86400);

    expect(relativeLabel(old, NOW)).toBe(old.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }));
    expect(timeAgo(old, NOW)).toBe(`on ${relativeLabel(old, NOW)}`);
  });

  it('is finer than timeAgo where a heartbeat needs it', () => {
    expect(timeAgo(at(-45), NOW)).toBe('just now');
    expect(relativeLabel(at(-45), NOW)).toBe('45s ago');
  });
});
