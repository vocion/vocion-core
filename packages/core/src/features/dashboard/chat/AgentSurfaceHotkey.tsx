'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { requestAgentSurface } from './agentSurface';

/**
 * The keyboard entry point: ⌘K (Ctrl+K) opens whatever agent surface the
 * page carries, through the same one function as every other entry point
 * (agent-chat-surface.md §6). Unclaimed — no surface mounted — falls back to
 * the everything-scoped chat page. Yields on the roadmap docs routes, whose
 * search owns ⌘K, and to any handler that already claimed the key.
 */
export function AgentSurfaceHotkey() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k' || e.defaultPrevented) {
        return;
      }
      if (pathname.includes('/dashboard/roadmap')) {
        return;
      }
      e.preventDefault();
      if (!requestAgentSurface()) {
        router.push('/dashboard/chat');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pathname, router]);

  return null;
}
