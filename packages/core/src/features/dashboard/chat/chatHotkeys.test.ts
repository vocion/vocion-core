import { describe, expect, it } from 'vitest';
import { CHAT_HOTKEYS, chatHotkeyLabel, isChatPage, matchChatHotkey } from './chatHotkeys';

describe('matchChatHotkey', () => {
  it('needs ⌘/Ctrl AND Shift — plain ⌘O is the browser\'s', () => {
    expect(matchChatHotkey({ key: 'o', metaKey: true, shiftKey: true })).toBe('new-chat');
    expect(matchChatHotkey({ key: 'O', ctrlKey: true, shiftKey: true })).toBe('new-chat');
    expect(matchChatHotkey({ key: 'o', metaKey: true })).toBeNull();
    expect(matchChatHotkey({ key: 'o', shiftKey: true })).toBeNull();
    expect(matchChatHotkey({ key: 'o', metaKey: true, shiftKey: true, altKey: true })).toBeNull();
  });

  it('maps L to the chat page and H to the list of conversations', () => {
    expect(matchChatHotkey({ key: 'l', metaKey: true, shiftKey: true })).toBe('go-to-chat');
    expect(matchChatHotkey({ key: 'h', metaKey: true, shiftKey: true })).toBe('all-conversations');
    expect(matchChatHotkey({ key: 'k', metaKey: true, shiftKey: true })).toBeNull();
  });

  it('yields to a handler closer to the key', () => {
    expect(matchChatHotkey({ key: 'o', metaKey: true, shiftKey: true, defaultPrevented: true })).toBeNull();
  });

  it('labels every action, and never with a browser-reserved key', () => {
    for (const h of CHAT_HOTKEYS) {
      expect(chatHotkeyLabel(h.action)).toBe(h.label);
      expect(['t', 'n', 'w', 'q']).not.toContain(h.key);
    }
  });

  it('knows the chat page with and without a thread', () => {
    expect(isChatPage('/dashboard/chat')).toBe(true);
    expect(isChatPage('/en/dashboard/chat/118')).toBe(true);
    expect(isChatPage('/dashboard/chat-settings')).toBe(false);
    expect(isChatPage('/dashboard/conversations')).toBe(false);
  });
});
