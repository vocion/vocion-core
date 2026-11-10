import type { SavingsRun } from './savings';
import { describe, expect, it } from 'vitest';
import { dollars, duration, monthStart, savingMethod, savingSentence, savingsOf, tokensLabel, weeklySavings, weekOf } from './savings';

const run = (over: Partial<SavingsRun> = {}): SavingsRun => ({ status: 'done', manualMinutes: 4, humanMs: 0, cents: 12, tokens: 40_000, decisions: 0, at: '2026-11-03T15:00:00Z', ...over });
const RATE = { cents: 4500, of: 'specialist' };

describe('what automations saved', () => {
  it('is the finished runs by hand, less people\'s time on them, at the hourly rate, for what the runs cost', () => {
    const s = savingsOf([run(), run({ humanMs: 120_000, decisions: 1 }), run({ status: 'failed', cents: 30 }), run({ overhead: true, manualMinutes: null, cents: 8 })], RATE);

    expect(s.runs).toBe(3);
    expect(s.done).toBe(2);
    expect(s.byHandMinutes).toBe(8);
    expect(s.savedMinutes).toBe(6);
    expect(s.savedCents).toBe(450);
    expect(s.costCents).toBe(12 + 12 + 30 + 8);
    expect(s.decisions).toBe(1);
    expect(savingSentence(s, 'this week')).toBe('Saved 6 minutes this week, $4.50 of specialist time, for $0.62 of runs.');
  });

  it('states no saving without a baseline, and no worth without a rate', () => {
    const none = savingsOf([run({ manualMinutes: null })], RATE);

    expect(none.savedMinutes).toBeNull();
    expect(savingSentence(none)).toBeNull();
    expect(savingMethod(none)).toEqual(['The runs cost $0.12: 40k tokens of model calls across 1 run, from the spend ledger.']);

    const unpriced = savingsOf(Array.from({ length: 30 }, () => run({ manualMinutes: 20 })), null);

    expect(unpriced.savedCents).toBeNull();
    expect(savingSentence(unpriced, 'this month')).toBe('Saved 10 hours this month, for $3.60 of runs.');
  });

  it('says how each number is worked out, a line each', () => {
    const lines = savingMethod(savingsOf([run({ manualMinutes: 20 }), run({ manualMinutes: 20, humanMs: 60_000, decisions: 1 })], RATE));

    expect(lines[0]).toBe('By hand: 40 minutes for the 2 finished runs (20 min each, the automation’s baseline).');
    expect(lines[1]).toBe('People still spent 1 minute on 1 decision, leaving 39 minutes saved.');
    expect(lines[2]).toBe('At $45 an hour of specialist time, that is $29.');
  });

  it('counts weeks from Monday in the workspace\'s zone, with empty weeks kept', () => {
    // Sunday evening in Chicago is Monday in UTC: it still belongs to the week before.
    expect(weekOf(Date.parse('2026-11-02T03:00:00Z'), 'America/Chicago')).toBe('2026-10-26');
    expect(weekOf(Date.parse('2026-11-04T15:00:00Z'), 'America/Chicago')).toBe('2026-11-02');

    const weeks = weeklySavings([run({ at: '2026-10-20T15:00:00Z' }), run({ at: '2026-11-03T15:00:00Z' })], null, { weeks: 4, now: Date.parse('2026-11-04T15:00:00Z'), timeZone: 'America/Chicago' });

    expect(weeks.map(w => w.label)).toEqual(['Oct 12', 'Oct 19', 'Oct 26', 'Nov 2']);
    expect(weeks.map(w => w.savings.runs)).toEqual([0, 1, 0, 1]);
  });

  it('starts the month at midnight in the zone', () => {
    expect(new Date(monthStart(Date.parse('2026-11-04T15:00:00Z'), 'America/Chicago')).toISOString()).toBe('2026-11-01T05:00:00.000Z');
  });

  it('reads numbers as people say them', () => {
    expect(dollars(248_000)).toBe('$2,480');
    expect(dollars(410)).toBe('$4.10');
    expect(duration(45)).toBe('45 minutes');
    expect(duration(60)).toBe('1 hour');
    expect(duration(150)).toBe('2.5 hours');
    expect(duration(31 * 60 + 10)).toBe('31 hours');
    expect(tokensLabel(840)).toBe('840');
    expect(tokensLabel(38_400)).toBe('38k');
    expect(tokensLabel(1_200_000)).toBe('1.2M');
  });
});
