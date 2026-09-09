'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { requestAgentSurface } from './agentSurface';

/**
 * The keyboard entry point: ⌘J (Ctrl+J) opens whatever agent surface the
 * page carries (⌘K belongs to the command palette), through the same one function as every other entry point
 * (agent-chat-surface.md §6). Unclaimed — no surface mounted — falls back to
 * the everything-scoped chat page. Yields to any handler that already claimed the key.
 */
export function AgentSurfaceHotkey() {
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'j' || e.defaultPrevented) {
        return;
      }
      e.preventDefault();
      if (!requestAgentSurface()) {
        router.push('/dashboard/chat');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  return null;
}
