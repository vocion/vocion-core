import { describe, expect, it } from 'vitest';
import { applyPins, movePin, splitOverflow, togglePin, withoutPins } from './navPins';

const items = [
  { url: '/dashboard/p/deal-desk', title: 'Deal desk' },
  { url: '/dashboard/p/hiring', title: 'Hiring' },
  { url: '/dashboard/chat/42?grid=open', title: 'Pipeline canvas' },
  { url: '/dashboard/teams', title: 'Teams' },
];

describe('nav pins', () => {
  it('renders pinned items in pin order and drops stale pins', () => {
    const pins = ['/dashboard/teams', '/dashboard/p/gone', '/dashboard/p/deal-desk'];

    expect(applyPins(items, pins).map(i => i.title)).toEqual(['Teams', 'Deal desk']);
    expect(withoutPins(items, pins).map(i => i.title)).toEqual(['Hiring', 'Pipeline canvas']);
  });

  it('toggles with one gesture: unpin removes, pin appends (pin time = order)', () => {
    let pins: string[] = [];
    pins = togglePin(pins, '/dashboard/p/hiring');
    pins = togglePin(pins, '/dashboard/teams');

    expect(pins).toEqual(['/dashboard/p/hiring', '/dashboard/teams']);
    expect(togglePin(pins, '/dashboard/p/hiring')).toEqual(['/dashboard/teams']);
  });

  it('reorders by moving a pin to an index and ignores unknown urls', () => {
    const pins = ['a', 'b', 'c'];

    expect(movePin(pins, 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(movePin(pins, 'a', 99)).toEqual(['b', 'c', 'a']);
    expect(movePin(pins, 'zzz', 0)).toEqual(pins);
  });

  it('splits at seven for the "More pages" submenu', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ url: `/p/${i}` }));

    expect(splitOverflow(many, 7).shown).toHaveLength(7);
    expect(splitOverflow(many, 7).more.map(m => m.url)).toEqual(['/p/7', '/p/8']);
    expect(splitOverflow(many.slice(0, 3), 7).more).toEqual([]);
  });
});
