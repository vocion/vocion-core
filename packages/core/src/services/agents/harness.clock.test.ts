import { describe, expect, it } from 'vitest';
import { clockLine } from '@/libs/time/zone';
import { CLOCK_RULES } from './clockRules';

/**
 * The agent must know what day it is — for the PERSON.
 *
 * On 2026-09-17 the lead answered "what should I do right now?" by reading a
 * stale briefing and serving its critical path as the current day. Chris:
 * "WTF. do you know what day it is?"* A NOW was added to the system prompt,
 * and on 2026-09-18 two more failures followed: that prompt is cached with
 * the compiled graph, so NOW was hours stale; and it was UTC only, so for a
 * person in Pacific time "today" turned at 5pm and calendar times came back
 * relabelled in the wrong zone. NOW now rides on every turn, in the person's
 * zone; the prompt keeps only the rules.
 */

const NOW = new Date('2026-09-18T00:30:00.000Z'); // Thu 5:30pm Pacific, already Friday in UTC

describe('the clock the agent is given', () => {
  it('states the instant in the person\'s zone, with UTC beside it, and names the day', () => {
    const line = clockLine(NOW, 'America/Los_Angeles');

    expect(line).toContain('NOW: Thu, Sep 17, 2026, 5:30 PM PDT (America/Los_Angeles)');
    expect(line).toContain('2026-09-18T00:30:00.000Z UTC');
    expect(line).toContain('Today is Thu, Sep 17, 2026');
    expect(line).toContain('state times in their zone (America/Los_Angeles)');
  });

  it('carries a parseable instant, so the model can compare a document date against it', () => {
    const iso = /· (\S+) UTC/.exec(clockLine(NOW, 'UTC'))?.[1];

    expect(iso).toBe('2026-09-18T00:30:00.000Z');
    expect(Number.isNaN(Date.parse(iso!))).toBe(false);
  });

  it('tells the model where NOW is and forbids computing the weekday itself', () => {
    expect(CLOCK_RULES).toContain('stated at the top of every message');
    expect(CLOCK_RULES).toContain('never compute a weekday yourself');
    expect(CLOCK_RULES).not.toMatch(/NOW: \d{4}-/);
  });

  it('says a document older than now is history, which is the error that caused this', () => {
    expect(CLOCK_RULES).toContain('is HISTORY');
    expect(CLOCK_RULES).toMatch(/never say "today".*without first checking/i);
    expect(CLOCK_RULES).toContain('cannot tell when it is from');
  });
});
