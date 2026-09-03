'use client';

import { MessageCircle } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { requestAgentSurface } from './agentSurface';

/**
 * The titlebar entry point: opens whatever agent surface this page carries,
 * through the same one function as the hotkey and the record itself
 * (agent-chat-surface.md §3, §6). Hidden on the full-page chat, which IS the
 * conversation. An unclaimed request — no surface mounted — navigates to the
 * everything-scoped chat page.
 */
export function AgentSurfaceButton() {
  const router = useRouter();
  const pathname = usePathname();

  if (pathname === '/dashboard/chat' || pathname.endsWith('/dashboard/chat')) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (!requestAgentSurface()) {
          router.push('/dashboard/chat');
        }
      }}
      aria-label="Ask the agent"
      title="Ask the agent (⌘K)"
      className="flex size-11 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground sm:size-9"
    >
      <MessageCircle className="size-4" aria-hidden="true" />
    </button>
  );
}
