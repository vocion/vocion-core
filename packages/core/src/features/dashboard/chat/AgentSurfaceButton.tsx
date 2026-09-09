'use client';

import { Sparkles } from 'lucide-react';
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
      title="Ask the agent (⌘J)"
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[13px] font-medium text-foreground shadow-xs transition hover:bg-muted"
    >
      <Sparkles className="size-4 text-brand-amber" aria-hidden="true" />
      <span>Ask</span>
      <kbd className="ml-0.5 hidden rounded border border-border bg-muted px-1 font-sans text-[10px] text-muted-foreground lg:inline">⌘J</kbd>
    </button>
  );
}
