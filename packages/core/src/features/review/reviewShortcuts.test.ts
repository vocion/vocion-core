import { describe, expect, it } from 'vitest';
import { shortcutFor, SHORTCUTS } from './reviewShortcuts';

describe('shortcutFor', () => {
  it('maps the six keys to their actions', () => {
    for (const s of SHORTCUTS) {
      expect(shortcutFor({ key: s.key })).toBe(s.action);
    }
  });

  it('ignores unknown keys', () => {
    expect(shortcutFor({ key: 'x' })).toBeNull();
    expect(shortcutFor({ key: 'Enter' })).toBeNull();
  });

  it('ignores modifier chords so browser shortcuts keep working', () => {
    expect(shortcutFor({ key: 'a', metaKey: true })).toBeNull();
    expect(shortcutFor({ key: 'j', ctrlKey: true })).toBeNull();
    expect(shortcutFor({ key: 'd', altKey: true })).toBeNull();
  });

  it('never fires while the person is typing', () => {
    expect(shortcutFor({ key: 'a', target: { tagName: 'input' } })).toBeNull();
    expect(shortcutFor({ key: 'a', target: { tagName: 'TEXTAREA' } })).toBeNull();
    expect(shortcutFor({ key: 'a', target: { tagName: 'SELECT' } })).toBeNull();
    expect(shortcutFor({ key: 'a', target: { tagName: 'DIV', isContentEditable: true } })).toBeNull();
    expect(shortcutFor({ key: 'a', target: { tagName: 'BUTTON' } })).toBe('approve');
  });
});
