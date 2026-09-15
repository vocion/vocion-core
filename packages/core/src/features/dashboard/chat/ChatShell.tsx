'use client';

import type { AgentOption } from './types';
import { MessagesSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { EmptyState as PageEmptyState } from '@/components/ui/empty-state';
import { ShellBarActionsPortal } from '@/features/dashboard/ShellBarActions';
import { AGENT_SURFACE_EVENT, focusAgentComposer } from './agentSurface';
import { ChatComposer } from './ChatComposer';
import { ChatMenu } from './ChatMenu';
import { EmptyState } from './EmptyState';
import { HistoryPopover } from './HistoryPopover';
import { HitlGate } from './HitlGate';
import { MessageList } from './MessageList';
import { SourcesPanel } from './SourcesPanel';
import { useTagSearch } from './tagSearch';
import { useChatSession } from './useChatSession';

/**
 * ChatShell — the full-page chat surface.
 *
 * A render wrapper over `useChatSession`, which owns the transcript, the SSE
 * wire, the boot/resume sequence and the conversation pointers. The floating
 * `ChatDock` renders the same hook with its own chrome, so both surfaces
 * behave identically and resume the same conversation.
 *
 * Agent identity is data-in: the server component that mounts ChatShell
 * passes the available agents (DB rows + the virtual `__search__` entry) and
 * optionally a starting `agentSlug`. The pre-v0.5.2 default to "Sales
 * Assistant" is gone.
 *
 * "Insert quarter, shoot aliens": the surface is messages + composer,
 * period. No permanent header, no picker on the canvas — new chat and
 * agent targeting live behind the single ⋯ menu, portaled into the shell
 * top bar so the conversation canvas stays clean.
 *
 * Component tree:
 *   <AgentSwitcher /> + <ChatMenu /> (portaled into the shell top bar)
 *   <MessageList /> or <EmptyState />
 *   <SourcesPanel /> (right-side, optional)
 *   <HitlGate /> (above composer when pending)
 *   <ChatComposer />
 */

export type ChatShellProps = {
  /** Agents available to pick from. The caller guarantees at least one entry. */
  agents: AgentOption[];
  /** Pre-fills the composer without sending (e.g. the org chart's seeded "how's the quarter?" prompt). */
  initialComposerValue?: string;
  /** Dynamic workspace-scoped empty-state chips (urgency + capability). */
  suggestions?: Array<{ label: string; prompt: string }>;
  /** Empty-state greeting: org eyebrow + "Ask <workspace>". */
  greeting?: { eyebrow?: string; workspace: string };
  /** A thread the URL names (`?conversation=<id>`) — resume it instead of starting fresh (§9). */
  conversationId?: number | null;
};

/**
 * Bails out before `useChatSession` when there is nobody to chat with.
 *
 * `useChatSession` picks a default agent with `agents[0]!` and reads its slug
 * straight away, so an empty list crashed the page rather than showing
 * anything. It reaches here empty in one case: the shell could not resolve a
 * workspace, which is what a stale session cookie from another workspace looks
 * like. `loadChatAgentContext` always appends the virtual search entry, so a
 * workspace that resolved is never empty even before its first agent is
 * authored.
 *
 * The guard sits one level above the hook rather than inside it, matching
 * `PageDock` and `ChatDock`: React lets a component's hooks be skipped
 * entirely by never rendering it, and `useChatSession` does real work on mount
 * — a `client.chatWidget.getState()` call and a hand-off effect that can write
 * a conversation — none of which should run with no agent to run it for.
 * @param props - Component props.
 * @param props.agents - Agents available to pick from. Empty renders the empty state.
 * @param props.initialComposerValue - Text to pre-fill the composer with.
 * @param props.suggestions - Empty-state chips.
 * @param props.greeting - Empty-state greeting.
 * @param props.conversationId
 */
export function ChatShell({
  agents,
  initialComposerValue,
  suggestions = [],
  greeting,
  conversationId = null,
}: ChatShellProps) {
  if (agents.length === 0) {
    return <NoAgentsToChatWith />;
  }

  return (
    <ChatShellInner
      agents={agents}
      initialComposerValue={initialComposerValue}
      suggestions={suggestions}
      greeting={greeting}
      conversationId={conversationId}
    />
  );
}

/**
 * What the chat page shows when no workspace resolved, in place of a crash.
 *
 * Signing in again is the fix when a session points at a workspace this
 * deployment does not have — the usual cause on a developer's machine, where
 * two checkouts on different ports share one cookie.
 */
function NoAgentsToChatWith() {
  return (
    <div className="flex h-full items-center justify-center">
      <PageEmptyState
        icon={MessagesSquare}
        title="No agents to chat with"
        description="This workspace has no agents available. If you were signed in elsewhere, sign in again — a session from another workspace cannot load this one's agents."
      />
    </div>
  );
}

function ChatShellInner({
  agents,
  initialComposerValue,
  suggestions = [],
  greeting,
  conversationId = null,
}: ChatShellProps) {
  const t = useTranslations('Chat');
  const session = useChatSession({ agents, initialComposerValue, suggestions, greeting, resumeConversationId: conversationId });
  const tagSearch = useTagSearch(agents);
  const autonomyCopy = {
    ask: t('autonomy_ask'),
    act: t('autonomy_act'),
    askHint: t('autonomy_ask_hint'),
    actHint: t('autonomy_act_hint'),
  };

  // The full-page chat IS this page's agent surface: an entry-point request
  // (the hotkey, a rail control) focuses the composer instead of opening a
  // second surface (032 §6).
  useEffect(() => {
    function onRequest(e: Event) {
      e.preventDefault();
      focusAgentComposer(null);
    }
    window.addEventListener(AGENT_SURFACE_EVENT, onRequest);
    return () => window.removeEventListener(AGENT_SURFACE_EVENT, onRequest);
  }, []);

  return (
    <div className="relative flex h-full flex-1 flex-col">
      {/* The single small chat menu — portaled into the shell top bar beside
          the account menu, so the conversation canvas stays clean. */}
      <ShellBarActionsPortal>
        <div className="flex items-center gap-1">
          {/* One identity (§9.10): the surface speaks as the workspace. */}
          <span data-testid="speaker-chip" className="truncate text-sm font-medium text-foreground/80">{session.workspaceName}</span>
          <HistoryPopover
            recent={session.recentChats}
            currentId={session.conversationId}
            onPick={id => void session.handlePickConversation(id)}
            onNewChat={session.handleNewChat}
            search={session.searchConversations}
          />
          <ChatMenu onNewChat={session.handleNewChat} />
        </div>
      </ShellBarActionsPortal>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col">
          {!session.booted || (session.resuming && session.messages.length === 0)
            ? (
                // One stable skeleton until the restore + resume settles, so a
                // reload reveals the final view in a single transition instead
                // of flashing default-agent → chips → transcript.
                <div className="flex flex-1 flex-col justify-end gap-4 px-4 py-6" aria-hidden>
                  {[80, 55, 68].map((width, i) => (
                    <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                      <div className="h-16 animate-pulse rounded-2xl bg-muted/50" style={{ width: `${width}%` }} />
                    </div>
                  ))}
                </div>
              )
            : session.messages.length === 0
              ? (
                  <EmptyState
                    greeting={session.emptyGreeting}
                    suggestions={session.emptyChips}
                    suggestionsLoading={session.emptyChipsLoading}
                    onPick={session.handlePickSuggestion}
                  />
                )
              : (
                  <MessageList
                    messages={session.messages}
                    agentName={session.workspaceName}
                    streaming={session.isStreaming}
                    activity={session.activity}
                    onShowSources={session.handleShowSources}
                    onCitationClick={session.handleCitationClick}
                    onFeedback={session.handleFeedback}
                    autonomy={session.autonomy}
                  />
                )}

          {session.pendingHitl && (
            <HitlGate
              gate={session.pendingHitl}
              onApprove={session.handleApproveHitl}
              onReject={session.handleRejectHitl}
              disabled={session.isStreaming}
            />
          )}

          <ChatComposer
            value={session.composerValue}
            onChange={session.setComposerValue}
            onSubmit={() => void session.sendMessage(session.composerValue)}
            // Also disabled until boot settles: a message sent while the saved
            // thread is still loading would be discarded when the restored
            // transcript lands.
            disabled={session.isStreaming || !session.booted}
            streaming={session.isStreaming}
            onStop={session.handleStop}
            placeholder={session.composerPlaceholder}
            pastedText={session.pastedText}
            onPasteText={session.setPastedText}
            onClearPasted={() => session.setPastedText(null)}
            tags={session.contextRefs}
            onAddTag={session.addContextRef}
            onRemoveTag={session.removeContextRef}
            tagSearch={tagSearch}
            autonomy={session.autonomy}
            onAutonomyChange={session.setAutonomy}
            autonomyCopy={autonomyCopy}
          />
        </div>

        <SourcesPanel
          documents={session.allDocuments}
          open={session.sourcesOpen && session.allDocuments.length > 0}
          onClose={() => session.setSourcesOpen(false)}
          focusCitation={session.focusCitation}
          citedIndices={session.citedIndices}
        />
      </div>
    </div>
  );
}
