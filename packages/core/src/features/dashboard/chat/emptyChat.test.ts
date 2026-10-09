import { describe, expect, it } from 'vitest';
import { firstNameOf, mayDockCard, partOfDay, startersToShow, waitingNudgeCount } from './emptyChat';

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

  it('offers at most three starters', () => {
    expect(startersToShow(['a', 'b', 'c', 'd', 'e'])).toEqual(['a', 'b', 'c']);
    expect(startersToShow(['a'])).toEqual(['a']);
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
