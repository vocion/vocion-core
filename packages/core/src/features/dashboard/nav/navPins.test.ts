import { describe, expect, it } from 'vitest';
import { applyPins, defaultPinDismissal, dropPlace, movePinNear, pinStep, resolveWorkPins, splitOverflow, togglePin, withoutPins } from './navPins';

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

  it('reorders by moving a pin before or after another, up or down, and ignores unknown urls', () => {
    const pins = ['a', 'b', 'c'];

    expect(movePinNear(pins, 'c', 'a', 'before')).toEqual(['c', 'a', 'b']);
    expect(movePinNear(pins, 'a', 'c', 'after')).toEqual(['b', 'c', 'a']);
    expect(movePinNear(pins, 'a', 'b', 'after')).toEqual(['b', 'a', 'c']);
    expect(movePinNear(pins, 'c', 'b', 'before')).toEqual(['a', 'c', 'b']);
    expect(movePinNear(pins, 'zzz', 'a', 'before')).toEqual(pins);
    expect(movePinNear(pins, 'a', 'zzz', 'before')).toEqual(pins);
    expect(movePinNear(pins, 'b', 'b', 'after')).toEqual(pins);
  });

  it('lands where it was dropped even when the list holds pins this group does not show', () => {
    // A work row pinned first (drawn in the main list) and a stale pin: the
    // Pinned group shows Teams, Missions, Workflows. Dragging Teams below
    // Missions used to do nothing, because the index it was dropped at (1)
    // was applied to this whole list.
    const pins = ['/dashboard/artifacts', '/dashboard/teams', '/dashboard/p/gone', '/dashboard/missions', '/dashboard/workflows'];
    const shownInPinned = ['/dashboard/teams', '/dashboard/missions', '/dashboard/workflows'];

    const once = movePinNear(pins, '/dashboard/teams', '/dashboard/missions', 'after');

    expect(once.filter(p => shownInPinned.includes(p))).toEqual(['/dashboard/missions', '/dashboard/teams', '/dashboard/workflows']);

    const twice = movePinNear(once, '/dashboard/workflows', '/dashboard/missions', 'before');

    expect(twice.filter(p => shownInPinned.includes(p))).toEqual(['/dashboard/workflows', '/dashboard/missions', '/dashboard/teams']);
    // Nothing else moved, and nothing was dropped.
    expect(twice.filter(p => !shownInPinned.includes(p))).toEqual(['/dashboard/artifacts', '/dashboard/p/gone']);
  });

  it('steps one place among the rows the group shows, and stops at either end', () => {
    const shown = ['a', 'b', 'c'];

    expect(pinStep(shown, 'b', -1)).toEqual({ target: 'a', place: 'before' });
    expect(pinStep(shown, 'b', 1)).toEqual({ target: 'c', place: 'after' });
    expect(pinStep(shown, 'a', -1)).toBeNull();
    expect(pinStep(shown, 'c', 1)).toBeNull();
    expect(pinStep(shown, 'zzz', 1)).toBeNull();
  });

  it('drops above a row on its top half and below it on its bottom half', () => {
    expect(dropPlace(105, { top: 100, height: 32 })).toBe('before');
    expect(dropPlace(125, { top: 100, height: 32 })).toBe('after');
  });

  it('splits at seven for the "More pages" submenu', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ url: `/p/${i}` }));

    expect(splitOverflow(many, 7).shown).toHaveLength(7);
    expect(splitOverflow(many, 7).more.map(m => m.url)).toEqual(['/p/7', '/p/8']);
    expect(splitOverflow(many.slice(0, 3), 7).more).toEqual([]);
  });
});

describe('resolveWorkPins', () => {
  const defaults = ['/dashboard/briefings'];

  it('starts everyone with the default pinned, ahead of their own pins', () => {
    expect(resolveWorkPins({ pins: ['/dashboard/search'], dismissed: [], defaults })).toEqual(['/dashboard/briefings', '/dashboard/search']);
  });

  it('keeps a default off once the person unpinned it — and back if they pin it themselves', () => {
    const dismissed = [defaultPinDismissal('/dashboard/briefings')];

    expect(resolveWorkPins({ pins: [], dismissed, defaults })).toEqual([]);
    expect(resolveWorkPins({ pins: ['/dashboard/rooms', '/dashboard/briefings'], dismissed, defaults })).toEqual(['/dashboard/rooms', '/dashboard/briefings']);
  });
});
