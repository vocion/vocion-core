'use client';

import { MessageCircle } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { requestAgentSurface } from './agentSurface';
import { useDockOpen } from './dockState';

/**
 * The titlebar entry point: opens whatever agent surface this page carries,
 * through the same one function as the hotkey and the record itself
 * (agent-chat-surface.md §3, §6). Hidden on the full-page chat, which IS the
 * conversation. An unclaimed request — no surface mounted — navigates to the
 * everything-scoped chat page.
 *
 * It TOGGLES (Chris, 2026-09-15: "chat bubble in the header should both open,
 * and collapse"). One control in one place, both directions, matching ⌘J —
 * rather than a button that opens and a different gesture that closes.
 */
export function AgentSurfaceButton() {
  const router = useRouter();
  const pathname = usePathname();
  const dockOpen = useDockOpen();

  if (pathname === '/dashboard/chat' || pathname.endsWith('/dashboard/chat')) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (!requestAgentSurface({ toggle: true })) {
          router.push('/dashboard/chat');
        }
      }}
      aria-expanded={dockOpen}
      aria-label={dockOpen ? 'Close the agent' : 'Ask the agent'}
      title={dockOpen ? 'Close the agent (⌘J)' : 'Ask the agent (⌘J)'}
      className={`flex size-11 items-center justify-center rounded-full transition hover:bg-muted hover:text-foreground sm:size-9 ${dockOpen ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
    >
      <MessageCircle className="size-4" aria-hidden="true" />
    </button>
  );
}
