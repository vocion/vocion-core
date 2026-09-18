'use client';

import type { SlashCommandAction } from './slashCommands';
import { useCallback } from 'react';
import { useRouter } from '@/libs/I18nNavigation';

/**
 * What a slash command does on a surface (`slashCommands.ts`). Every chat
 * surface — the full page, the rail, the artifact view — hands this to its
 * composer, so `/new` and `/history` mean the same thing everywhere; only
 * "start over" differs per surface, and that is the one thing injected.
 * @param onNewChat - How THIS surface starts a fresh thread.
 */
export function useChatCommands(onNewChat: () => void): (action: SlashCommandAction) => void {
  const router = useRouter();
  return useCallback((action: SlashCommandAction) => {
    if (action === 'new-chat') {
      onNewChat();
    } else if (action === 'all-conversations') {
      router.push('/dashboard/conversations');
    } else if (action === 'go-to-chat') {
      router.push('/dashboard/chat');
    }
    // `/search` carries text and goes through the send path.
  }, [onNewChat, router]);
}
