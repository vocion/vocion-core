'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from '@/libs/I18nNavigation';
import { focusAgentComposer, requestAgentSurface } from './agentSurface';
import { isChatPage, matchChatHotkey } from './chatHotkeys';

/**
 * The global chat hotkeys (`chatHotkeys.ts`), mounted once by the shell
 * beside the ⌘K palette.
 *
 * New chat goes through the ONE entry function (agent-chat-surface.md §6):
 * a mounted surface — the full page, the rail — claims `{ newChat: true }`
 * and starts over in place; nothing mounted means we navigate to the chat
 * page asking for a fresh thread (`?new=1`, honoured by `ChatShell`).
 */
export function ChatHotkeyListener() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const action = matchChatHotkey(e);
      if (!action) {
        return;
      }
      e.preventDefault();
      switch (action) {
        case 'new-chat':
          if (!requestAgentSurface({ newChat: true })) {
            router.push('/dashboard/chat?new=1');
          }
          return;
        case 'go-to-chat':
          if (isChatPage(pathname)) {
            focusAgentComposer(null);
          } else {
            router.push('/dashboard/chat');
          }
          return;
        case 'all-conversations':
          router.push('/dashboard/conversations');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pathname, router]);

  return null;
}
