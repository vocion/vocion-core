/**
 * The agent had no calendar. It answered "what's on my calendar today" from a
 * briefing written hours earlier by a different run, and on 2026-09-17 it read
 * out a 10:30am call, at 12:51pm, that was not on the calendar at all.
 *
 * Three fixes to dates, staleness and citations could not repair that, because
 * none of them made anything LOOK at the calendar. These cover the two things
 * that do: a bounded window, and the past/future split done in code.
 */
import { describe, expect, it } from 'vitest';
import { relativeTime, renderCalendar } from './calendarEvents';

const NOW = new Date('2026-09-17T19:51:00Z'); // 12:51pm PT

const ev = (summary: string, startIso: string, over: Record<string, unknown> = {}) => ({
  summary,
  start: { dateTime: startIso },
  end: { dateTime: startIso },
  ...over,
});

describe('relativeTime', () => {
  it('reads the way a person would say it', () => {
    expect(relativeTime(new Date('2026-09-17T21:00:00Z'), NOW)).toBe('in 1h 9m');
    expect(relativeTime(new Date('2026-09-17T20:20:00Z'), NOW)).toBe('in 29m');
    expect(relativeTime(new Date('2026-09-17T17:30:00Z'), NOW)).toBe('2h 21m ago');
    expect(relativeTime(new Date('2026-09-17T19:53:00Z'), NOW)).toBe('now');
  });
});

describe('renderCalendar', () => {
  it('splits what is left from what already happened', () => {
    // The exact failure: a 10:30am call read out at 12:51pm as if pending.
    const out = renderCalendar(
      [ev('Bid outcome call', '2026-09-17T17:30:00Z'), ev('Vocion Sync', '2026-09-17T21:00:00Z')],
      NOW,
      'today (2026-09-17)',
    );

    const ahead = out.indexOf('STILL AHEAD');
    const past = out.indexOf('ALREADY HAPPENED');

    expect(ahead).toBeGreaterThan(-1);
    expect(past).toBeGreaterThan(ahead);
    expect(out.indexOf('Vocion Sync')).toBeGreaterThan(ahead);
    expect(out.indexOf('Vocion Sync')).toBeLessThan(past);
    expect(out.indexOf('Bid outcome call')).toBeGreaterThan(past);
  });

  it('says nothing is on it rather than leaving a gap to fill', () => {
    const out = renderCalendar([], NOW, 'today (2026-09-17)');

    expect(out).toContain('Nothing on the calendar');
    expect(out).toContain('do not fill the gap');
  });

  it('says so plainly when the day is done', () => {
    const out = renderCalendar([ev('Standup', '2026-09-17T15:00:00Z')], NOW, 'today');

    expect(out).toContain('STILL AHEAD: nothing left today.');
  });

  it('drops cancelled events rather than reporting them as meetings', () => {
    const out = renderCalendar(
      [ev('Cancelled thing', '2026-09-17T21:00:00Z', { status: 'cancelled' })],
      NOW,
      'today',
    );

    expect(out).not.toContain('Cancelled thing');
  });

  it('states the time it was read, so the split can be checked', () => {
    expect(renderCalendar([ev('X', '2026-09-17T21:00:00Z')], NOW, 'today')).toContain('NOW: 2026-09-17T19:51:00.000Z');
  });

  it('carries attendees, so a meeting can be recognised', () => {
    const out = renderCalendar(
      [ev('Sync', '2026-09-17T21:00:00Z', { attendees: [{ displayName: 'Rowan Pike' }, { email: 'sam@northwind.example' }] })],
      NOW,
      'today',
    );

    expect(out).toContain('with: Rowan Pike, sam@northwind.example');
  });

  it('handles an all-day event without inventing a time for it', () => {
    const out = renderCalendar([{ summary: 'Offsite', start: { date: '2026-09-17' } }], NOW, 'today');

    expect(out).toContain('Offsite — 2026-09-17 (all day)');
  });
});
