'use client';

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
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
    >
      New Chat
    </button>
  );
};
