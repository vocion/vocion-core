import { describe, expect, it } from 'vitest';

/**
 * The agent must know what day it is.
 *
 * On 2026-09-17 the lead answered "what should I do right now?" by reading a
 * stale briefing and serving its critical path as the current day — naming a
 * 10:30 call that was not on the calendar. Nothing in any system prompt
 * carried a date; `crm.ts` had even been written around the gap ("so you never
 * have to know today's date"). Chris: *"WTF. do you know what day it is?"*
 *
 * These assert the shape of the grounding rather than the harness wiring,
 * which needs a database: the clock line has to carry a machine-readable
 * instant AND the rule that a dated document older than now is history.
 */

const clock = (now: Date) => [
  `NOW: ${now.toISOString()} (UTC). Today is ${now.toUTCString().slice(0, 16)}.`,
  'Times you state must say their zone. Never say "today", "this morning" or "right now" about anything you read in a document without first checking that document\'s own date against NOW — a briefing, report or transcript dated before today is HISTORY, and presenting its schedule as the current day is the worst error you can make on this surface.',
  'If a document you are quoting is not dated, say that you cannot tell when it is from rather than assuming it is current.',
].join(' ');

describe('the clock the agent is given', () => {
  it('carries a parseable instant, so the model can compare a document date against it', () => {
    const line = clock(new Date('2026-09-17T16:00:00.000Z'));
    const iso = /NOW: (\S+) \(UTC\)/.exec(line)?.[1];

    expect(iso).toBe('2026-09-17T16:00:00.000Z');
    expect(Number.isNaN(Date.parse(iso!))).toBe(false);
  });

  it('names the weekday, because a briefing title states one', () => {
    expect(clock(new Date('2026-09-17T16:00:00.000Z'))).toContain('Thu, 17 Sep 2026');
  });

  it('says a document older than now is history, which is the error that caused this', () => {
    const line = clock(new Date('2026-09-17T16:00:00.000Z'));

    expect(line).toContain('is HISTORY');
    expect(line).toMatch(/never say "today".*without first checking/i);
  });

  it('tells it to admit when a document carries no date at all', () => {
    expect(clock(new Date())).toContain('cannot tell when it is from');
  });
});
