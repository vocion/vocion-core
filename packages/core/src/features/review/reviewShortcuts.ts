/**
 * Keyboard shortcuts for focus-mode review. One hand on the keyboard clears a
 * queue: `j`/`k` move, `a`/`d`/`s` decide, `?` shows the hint. Nothing fires
 * while the person is typing in a field — the shortcuts are for the queue,
 * never for the text.
 */

export type ReviewShortcut = 'next' | 'prev' | 'approve' | 'decline' | 'snooze' | 'help';

export const SHORTCUTS: ReadonlyArray<{ key: string; action: ReviewShortcut }> = [
  { key: 'j', action: 'next' },
  { key: 'k', action: 'prev' },
  { key: 'a', action: 'approve' },
  { key: 'd', action: 'decline' },
  { key: 's', action: 'snooze' },
  { key: '?', action: 'help' },
];

const KEY_TO_ACTION = new Map(SHORTCUTS.map(s => [s.key, s.action] as const));

export type ShortcutKeyEvent = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  /** The event target's tag name and editability, so a shortcut never fires mid-typing. */
  target?: { tagName?: string; isContentEditable?: boolean } | null;
};

/**
 * Map a key event to a review shortcut, or null when it should be ignored:
 * modifier chords belong to the browser, and keys typed into an input,
 * textarea, select or contenteditable are text, not commands.
 * @param e - The keydown event (or its relevant fields).
 */
export function shortcutFor(e: ShortcutKeyEvent): ReviewShortcut | null {
  if (e.metaKey || e.ctrlKey || e.altKey) {
    return null;
  }
  const tag = e.target?.tagName?.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) {
    return null;
  }
  return KEY_TO_ACTION.get(e.key) ?? null;
}
