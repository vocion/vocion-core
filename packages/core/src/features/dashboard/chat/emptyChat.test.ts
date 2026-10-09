import { describe, expect, it } from 'vitest';
import { firstNameOf, greetingFor, isReturning, mayDockCard, partOfDay, waitingNudgeCount } from './emptyChat';

/**
 * How a conversation starts, as one rule every surface reads (founder,
 * 2026-10-08: "Not jump right to big asks. Maybe a soft nudge or chip.").
 */
describe('how a conversation starts', () => {
  it('docks a card on an empty conversation only when the person started its flow', () => {
    expect(mayDockCard({ messageCount: 0, personStarted: false })).toBe(false);
    expect(mayDockCard({ messageCount: 0, personStarted: true })).toBe(true);
    expect(mayDockCard({ messageCount: 2, personStarted: false })).toBe(true);
  });

  it('says what waits as one count, until the person waves it away', () => {
    expect(waitingNudgeCount({ waiting: 3, dismissed: false })).toBe(3);
    expect(waitingNudgeCount({ waiting: 3, dismissed: true })).toBeNull();
    expect(waitingNudgeCount({ waiting: 0, dismissed: false })).toBeNull();
  });

  it('says one line, varied by the time and by a return', () => {
    const t = (key: string, values?: Record<string, string>) => `${key}${values ? ` ${JSON.stringify(values)}` : ''}`;

    expect(greetingFor({ hour: 20, returning: false, firstName: 'Sam' }, t)).toBe('greeting_named {"part":"evening","name":"Sam"}');
    expect(greetingFor({ hour: 9, returning: false }, t)).toBe('greeting {"part":"morning"}');
    expect(greetingFor({ hour: 9, returning: true, firstName: 'Sam' }, t)).toBe('welcome_back_named {"name":"Sam"}');
    expect(greetingFor({ hour: 9, returning: true, firstName: null }, t)).toBe('welcome_back');
  });

  it('counts as a return only after a while away', () => {
    const now = Date.now();

    expect(isReturning(null, now)).toBe(false);
    expect(isReturning(now - 60_000, now)).toBe(false);
    expect(isReturning(now - 7 * 60 * 60 * 1000, now)).toBe(true);
  });

  it('greets by the person\'s clock and first name, never an email address', () => {
    expect(partOfDay(8)).toBe('morning');
    expect(partOfDay(14)).toBe('afternoon');
    expect(partOfDay(21)).toBe('evening');
    expect(partOfDay(3)).toBe('evening');
    expect(firstNameOf('Sam Rivera')).toBe('Sam');
    expect(firstNameOf('sam@northwind.example')).toBeNull();
    expect(firstNameOf('  ')).toBeNull();
    expect(firstNameOf(undefined)).toBeNull();
  });
});
