/**
 * The chat hotkeys — pure, so the matcher is unit-tested away from React.
 *
 * Three keys, all ⌘⇧ (Ctrl+Shift) so they never collide with the browser's
 * reserved ⌘-letters or with the app's own ⌘K / ⌘J / ⌘B:
 *
 *   ⌘⇧O  start a new chat — the ChatGPT key, which is what people's hands
 *        already know;
 *   ⌘⇧L  go to the chat page (or focus its composer when already there);
 *   ⌘⇧H  the list of every conversation — history.
 *
 * The same three verbs are rows in the ⌘K palette, rows in the chat's ⋯
 * menu and `/new`, `/history` in the composer (`slashCommands.ts`): one
 * mechanism, four ways in. The labels here are the ones every surface shows.
 */

export type ChatHotkeyAction = 'new-chat' | 'go-to-chat' | 'all-conversations';

export const CHAT_HOTKEYS: ReadonlyArray<{ action: ChatHotkeyAction; key: string; label: string }> = [
  { action: 'new-chat', key: 'o', label: '⌘⇧O' },
  { action: 'go-to-chat', key: 'l', label: '⌘⇧L' },
  { action: 'all-conversations', key: 'h', label: '⌘⇧H' },
];

/**
 * The label a surface shows beside the verb, e.g. `⌘⇧O`.
 * @param action
 */
export function chatHotkeyLabel(action: ChatHotkeyAction): string {
  return CHAT_HOTKEYS.find(h => h.action === action)!.label;
}

/**
 * Which chat action a keydown asks for, or null. ⌘/Ctrl AND Shift, and not
 * already handled by something closer to the key.
 * @param e - A keyboard-event-like object.
 * @param e.key
 * @param e.metaKey
 * @param e.ctrlKey
 * @param e.shiftKey
 * @param e.altKey
 * @param e.defaultPrevented
 */
export function matchChatHotkey(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; defaultPrevented?: boolean }): ChatHotkeyAction | null {
  if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) {
    return null;
  }
  const key = e.key.toLowerCase();
  return CHAT_HOTKEYS.find(h => h.key === key)?.action ?? null;
}

/**
 * Whether a pathname is the full-page chat (with or without a thread id).
 * @param pathname
 */
export function isChatPage(pathname: string): boolean {
  return /\/dashboard\/chat(?:\/\d+)?\/?$/.test(pathname);
}
