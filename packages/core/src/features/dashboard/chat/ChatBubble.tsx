'use client';

import type { AgentOption } from './types';
import { MessageCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ChatBubbleHeader } from './ChatBubbleHeader';
import { ChatBubbleHistoryPanel } from './ChatBubbleHistoryPanel';
import { ChatComposer } from './ChatComposer';
import { EmptyState } from './EmptyState';
import { HitlGate } from './HitlGate';
import { MessageList } from './MessageList';
import { useChatSession } from './useChatSession';

export type ChatBubbleProps = {
  /** Agents available to pick from — server-loaded, same list the full-page chat uses. Empty array renders nothing. */
  agents: AgentOption[];
};

type VisualState = 'hidden' | 'normal' | 'maximized';

const VISUAL_STATE_KEY = 'vocion_chat_bubble_visual_state';

// useChatSession's contract guarantees the caller passes at least one
// agent (it indexes agents[0] unconditionally to pick a default). Rules of
// Hooks require calling it on every render regardless of `agents.length`,
// so when the real list is empty we hand it this placeholder instead —
// ChatBubble still returns null before that session data is ever rendered.
const NO_AGENTS_PLACEHOLDER: AgentOption = { slug: '__none__', name: '', icon: 'bot', placeholder: '' };

function readVisualState(): VisualState {
  try {
    const stored = localStorage.getItem(VISUAL_STATE_KEY);
    if (stored === 'normal' || stored === 'maximized') {
      return stored;
    }
  } catch {
    /* storage unavailable — default to hidden */
  }
  return 'hidden';
}

/**
 * Floating, Intercom-style chat widget mounted once in the dashboard layout
 * so it persists across every route. Visual state (hidden / normal /
 * maximized) is client-chrome only, persisted to localStorage — the
 * conversation content itself comes from `useChatSession`, which is the
 * same hook the full-page `/dashboard/chat` surface uses, so both stay in
 * sync on "last viewed conversation".
 */
export function ChatBubble({ agents }: ChatBubbleProps) {
  const [visualState, setVisualState] = useState<VisualState>('hidden');
  const [historyOpen, setHistoryOpen] = useState(false);
  const session = useChatSession({ agents: agents.length > 0 ? agents : [NO_AGENTS_PLACEHOLDER] });

  useEffect(() => {
    setVisualState(readVisualState());
  }, []);

  const setVisual = (next: VisualState) => {
    setVisualState(next);
    try {
      localStorage.setItem(VISUAL_STATE_KEY, next);
    } catch {
      /* storage unavailable — state still holds for this session */
    }
  };

  if (agents.length === 0) {
    return null;
  }

  if (visualState === 'hidden') {
    return (
      <button
        type="button"
        onClick={() => setVisual('normal')}
        aria-label="Open chat"
        className="fixed right-4 bottom-4 z-50 flex size-14 items-center justify-center rounded-full bg-brand-amber text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-brand-amber-deep"
      >
        <MessageCircle className="size-6" aria-hidden="true" />
      </button>
    );
  }

  const panelSizeClass = visualState === 'maximized'
    ? 'h-[85vh] w-[36rem] max-w-[90vw]'
    : 'h-[32rem] w-96 max-w-[90vw]';

  return (
    <div className={`fixed right-4 bottom-4 z-50 flex ${panelSizeClass} flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl`}>
      <div className="relative">
        <ChatBubbleHeader
          agentName={session.agent.name}
          agents={agents}
          currentSlug={session.agent.slug}
          onSwitchAgent={session.handleSwitchAgent}
          historyOpen={historyOpen}
          onToggleHistory={() => setHistoryOpen(open => !open)}
          onNewChat={() => {
            session.startNewConversation();
            setHistoryOpen(false);
          }}
          maximized={visualState === 'maximized'}
          onToggleMaximize={() => setVisual(visualState === 'maximized' ? 'normal' : 'maximized')}
          onClose={() => {
            setHistoryOpen(false);
            setVisual('hidden');
          }}
        />
        {historyOpen && (
          <ChatBubbleHistoryPanel
            agentSlug={session.agent.slug}
            activeConversationId={session.conversationId}
            onSelect={(id) => {
              void session.loadConversation(id);
              setHistoryOpen(false);
            }}
          />
        )}
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        {session.messages.length === 0
          ? <EmptyState agentName={session.agent.name} suggestions={session.agentSuggestions} onPick={session.handlePickSuggestion} />
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
          disabled={session.isStreaming}
          placeholder={session.agent.placeholder}
        />
      </div>
    </div>
  );
}
