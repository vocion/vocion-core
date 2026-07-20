'use client';

import { SquarePen } from 'lucide-react';

/**
 * v0.5.2 cleanup: this file was a 1898-LOC catch-all that contained both
 * the legacy `AskChat` chat surface (replaced by ChatShell + the
 * features/dashboard/chat/ subtree) and a hardcoded `AGENTS` constant
 * with a "Sales Assistant" placeholder. Everything except
 * `NewChatButton` was dead code — the only external import was from
 * `app/[locale]/(auth)/dashboard/chat/page.tsx` pulling
 * `NewChatButton`. Stripped to that one component to retire the dead
 * paths in one shot.
 *
 * The neighboring `features/dashboard/chat/` directory holds the
 * current chat implementation. Restart there for anything chat-shaped.
 */

export const NewChatButton = () => {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      aria-label="New Chat"
      title="New Chat"
      className="inline-flex size-11 items-center justify-center gap-1.5 rounded-md border border-border text-xs font-medium transition-colors hover:bg-muted sm:size-auto sm:px-3 sm:py-1.5"
    >
      <SquarePen className="size-4 sm:hidden" aria-hidden="true" />
      <span className="hidden sm:inline">New Chat</span>
    </button>
  );
};
