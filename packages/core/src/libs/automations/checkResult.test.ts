import { describe, expect, it } from 'vitest';
import { andList, checkLine, checkResult, passOutcome, readCheckResult } from './checkResult';

// What a monitor's pass writes, and how the page reads it back. Every name is invented.

const AT = new Date('2026-01-10T12:00:00Z');

describe('a check result', () => {
  it('takes the loudest outcome of its targets; none is a pass that did not check', () => {
    expect(passOutcome([{ outcome: 'quiet' }, { outcome: 'unchecked' }])).toBe('unchecked');
    expect(passOutcome([{ outcome: 'updated' }, { outcome: 'opened' }, { outcome: 'quiet' }])).toBe('opened');
    expect(passOutcome([{ outcome: 'quiet' }])).toBe('quiet');
    expect(passOutcome([])).toBe('unchecked');
    expect(checkResult({ kind: 'Sentry issues', threshold: '20 events', targets: [{ label: 'northwind-api', outcome: 'quiet', summary: 'no errors in the last hour', observed: {} }], why: 'token expired', at: AT }).outcome).toBe('unchecked');
  });

  it('reads back what was stored, tolerating what does not parse, and says nothing of a run that recorded none', () => {
    const stored = { acted: [], check: { kind: 'HTTP health', threshold: 'under 400', outcome: 'quiet', at: AT.toISOString(), targets: [{ label: 'app.northwind.example', outcome: 'quiet', summary: '200 in 312 ms', observed: { status: 200 } }, { label: '', outcome: 'quiet' }, { label: 'x', outcome: 'loud' }] } };
    const c = readCheckResult(stored)!;

    expect(c.targets).toEqual([{ label: 'app.northwind.example', outcome: 'quiet', summary: '200 in 312 ms', observed: { status: 200 } }]);
    expect(checkLine(c)).toBe('app.northwind.example: 200 in 312 ms');
    expect(readCheckResult({ acted: [] })).toBeNull();
    expect(readCheckResult({ check: { outcome: 'loud' } })).toBeNull();
    expect(readCheckResult(null)).toBeNull();
  });

  it('says each target in a few words, and why it could not check', () => {
    const c = checkResult({ kind: 'Sentry issues', threshold: '', at: AT, targets: [
      { label: 'northwind-api', outcome: 'quiet', summary: 'no errors in the last hour', observed: {} },
      { label: 'northwind-web', outcome: 'unchecked', summary: '', observed: {}, why: 'Sentry answered 403' },
    ] });

    expect(checkLine(c)).toBe('northwind-api: no errors in the last hour · northwind-web: could not check (Sentry answered 403)');
    expect(checkLine(checkResult({ kind: 'k', threshold: '', at: AT, targets: [], why: 'no project to watch' }))).toBe('Could not check: no project to watch');
    expect(andList(['a', 'b', 'c'])).toBe('a, b and c');
    expect(andList(['a'])).toBe('a');
  });
});
