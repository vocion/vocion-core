'use client';

import type { AgentOption } from './types';
import { SquarePen } from 'lucide-react';
import { AgentHeader } from './AgentHeader';
import { ChatComposer } from './ChatComposer';
import { EmptyState } from './EmptyState';
import { HitlGate } from './HitlGate';
import { MessageList } from './MessageList';
import { SourcesPanel } from './SourcesPanel';
import { useChatSession } from './useChatSession';

/**
 * ChatShell — full-page chat orchestrator.
 *
 * Thin render wrapper over `useChatSession`, which owns all state and
 * streaming logic (shared with the floating `ChatBubble`). Agent identity
 * is data-in: the server component that mounts ChatShell passes the
 * available agents (DB rows + the virtual `__search__` entry).
 */

export type ChatShellProps = {
  /** Agents available to pick from. Empty array renders the no-agents empty state. */
  agents: AgentOption[];
  agentDescription?: string;
  /** Suggestion prompts surfaced in the empty state (fallback — per-agent suggestions win). */
  suggestions?: Array<{ label: string; prompt: string }>;
};

export function ChatShell({ agents, agentDescription, suggestions = [] }: ChatShellProps) {
  const session = useChatSession({ agents, suggestions });

  return (
    <div className="flex h-full flex-1 flex-col">
      <AgentHeader
        name={session.agent.name}
        eyebrow={session.agentEyebrow}
        description={agentDescription ?? session.agent.description}
        action={(
          <button
            type="button"
            onClick={session.startNewConversation}
            aria-label="New Chat"
            title="New Chat"
            className="inline-flex size-11 items-center justify-center gap-1.5 rounded-md border border-border text-xs font-medium transition-colors hover:bg-muted sm:size-auto sm:px-3 sm:py-1.5"
          >
            <SquarePen className="size-4 sm:hidden" aria-hidden="true" />
            <span className="hidden sm:inline">New Chat</span>
          </button>
        )}
        agents={agents}
        currentSlug={session.agent.slug}
        onSwitch={session.handleSwitchAgent}
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col">
          {session.messages.length === 0
            ? <EmptyState agentName={session.agent.name} suggestions={session.agentSuggestions} onPick={session.handlePickSuggestion} disabled={!session.hydrated} />
            : <MessageList messages={session.messages} agentName={session.agent.name} streaming={session.isStreaming} activity={session.activity} />}

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
            onSubmit={() => session.sendMessage(session.composerValue)}
            onClearConversation={session.messages.length > 0 ? session.startNewConversation : undefined}
            disabled={session.isStreaming || !session.hydrated}
            placeholder={session.agent.placeholder}
          />
        </div>

        <SourcesPanel
          documents={session.allDocuments}
          open={session.sourcesOpen && session.allDocuments.length > 0}
          onClose={() => session.setSourcesOpen(false)}
        />
      </div>
    </div>
  );
}
