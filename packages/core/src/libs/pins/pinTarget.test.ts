import { describe, expect, it } from 'vitest';
import { addPin, isObjectPinKey, movePinWithin, parsePinKey, pinKey, pinTargetFromPath, removePin } from './pinTarget';

/**
 * Pinned objects share the sidebar's pins list with section pins, so the key
 * shape decides everything: which entries are objects, which page an app
 * page's pin is, what ⌘⇧P pins from a path, and where a drag lands when some
 * pins are hidden.
 */
describe('pin keys', () => {
  it('round-trips every object kind through one string', () => {
    for (const target of [
      { kind: 'conversation', id: '41' },
      { kind: 'artifact', id: '7' },
      { kind: 'wiki', id: 'wiki/founder-voice' },
      { kind: 'room', id: '12' },
      { kind: 'view', id: 'owed-replies' },
      { kind: 'record', id: '294' },
    ] as const) {
      expect(parsePinKey(pinKey(target))).toEqual(target);
      expect(isObjectPinKey(pinKey(target))).toBe(true);
    }
  });

  it('keeps an app page on the key the nav already pinned it under', () => {
    expect(pinKey({ kind: 'page', id: 'deal-desk' })).toBe('/dashboard/p/deal-desk');
    expect(parsePinKey('/dashboard/p/deal-desk')).toEqual({ kind: 'page', id: 'deal-desk' });
    expect(isObjectPinKey('/dashboard/p/deal-desk')).toBe(false);
  });

  it('reads a section pin or anything malformed as no object', () => {
    expect(parsePinKey('/dashboard/teams')).toBeNull();
    expect(parsePinKey('pin:nonsense:1')).toBeNull();
    expect(parsePinKey('pin:artifact:../../etc')).toBeNull();
    expect(parsePinKey('pin:page:x')).toBeNull();
  });
});

describe('pinTargetFromPath', () => {
  it('names the one thing a page is about, through workspace and locale prefixes', () => {
    expect(pinTargetFromPath('/w/northwind/dashboard/chat/41')).toEqual({ kind: 'conversation', id: '41' });
    expect(pinTargetFromPath('/fr/dashboard/artifacts/7/open')).toEqual({ kind: 'artifact', id: '7' });
    expect(pinTargetFromPath('/dashboard/rooms/12?tab=sources')).toEqual({ kind: 'room', id: '12' });
    expect(pinTargetFromPath('/dashboard/objects/294')).toEqual({ kind: 'record', id: '294' });
    expect(pinTargetFromPath('/dashboard/p/feature/294')).toEqual({ kind: 'record', id: '294' });
    expect(pinTargetFromPath('/dashboard/p/wiki/founder-voice')).toEqual({ kind: 'wiki', id: 'wiki/founder-voice' });
    expect(pinTargetFromPath('/dashboard/p/deal-desk')).toEqual({ kind: 'page', id: 'deal-desk' });
  });

  it('pins nothing from a page about nothing in particular', () => {
    expect(pinTargetFromPath('/dashboard/chat')).toBeNull();
    expect(pinTargetFromPath('/dashboard/inbox')).toBeNull();
    expect(pinTargetFromPath('/dashboard/p/runs/88')).toBeNull();
  });
});

describe('pin list edits', () => {
  it('appends a new pin and leaves an existing one where it is', () => {
    expect(addPin(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(addPin(['a', 'b'], 'a')).toEqual(['a', 'b']);
    expect(removePin(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('moves among the pins the person SEES, leaving hidden ones in place', () => {
    // `gone` is a pin whose target was deleted: stored, never drawn.
    const pins = ['a', 'gone', 'b', 'c'];
    const visible = ['a', 'b', 'c'];

    expect(movePinWithin(pins, visible, 'c', 0)).toEqual(['c', 'a', 'gone', 'b']);
    expect(movePinWithin(pins, visible, 'a', 1)).toEqual(['gone', 'b', 'a', 'c']);
    expect(movePinWithin(pins, visible, 'a', 2)).toEqual(['gone', 'b', 'c', 'a']);
    expect(movePinWithin(pins, visible, 'zzz', 0)).toEqual(pins);
  });
});
