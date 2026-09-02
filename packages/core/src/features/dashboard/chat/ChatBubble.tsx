'use client';

import type { AgentOption } from './types';
import { MessageCircle } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChatBubbleHeader } from './ChatBubbleHeader';
import { ChatBubbleHistoryPanel } from './ChatBubbleHistoryPanel';
import { ChatComposer } from './ChatComposer';
import { EmptyState } from './EmptyState';
import { HitlGate } from './HitlGate';
import { MessageList } from './MessageList';
import { useChatSession } from './useChatSession';
import { useDraggablePosition } from './useDraggablePosition';

export type ChatBubbleProps = {
  /** Agents available to pick from — server-loaded, same list the full-page chat uses. Empty array renders nothing. */
  agents: AgentOption[];
};

type VisualState = 'hidden' | 'normal' | 'maximized';

const VISUAL_STATE_KEY = 'vocion_chat_bubble_visual_state';
const POSITION_KEY = 'vocion_chat_bubble_position';

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
 * so it persists across every route — except `/dashboard/chat`, the
 * full-page chat surface, which already renders its own `ChatShell`.
 *
 * Checks `agents.length === 0` and the current route and bails out to
 * `null` BEFORE mounting `ChatBubbleInner` — not inside it — so that for a
 * brand-new org with no agents yet, or on the full-page chat route,
 * `useChatSession` (and everything it does on mount: a live
 * `client.chatWidget.getState()` call, plus a handoff effect that can fire
 * a real `client.conversations.create(...)` write) never runs at all. That
 * matters here specifically: both `ChatShell` and `ChatBubble` read and
 * consume the same one-shot `sessionStorage['vocion_chat_handoff']` stash,
 * so if both mounted on `/dashboard/chat`, whichever won the race would
 * silently steal a Briefings hand-off from the other.
 * React lets you skip a child component's hooks entirely by never
 * rendering it — you just can't skip a hook conditionally inside one
 * component's own body. Putting the early return here, one level up from
 * the hook call, is what makes that guarantee real instead of best-effort.
 * @param root0 - Component props.
 * @param root0.agents - Agents available to pick from. Empty array renders nothing.
 */
export function ChatBubble({ agents }: ChatBubbleProps) {
  const pathname = usePathname();
  const onChatPage = pathname === '/dashboard/chat' || pathname.endsWith('/dashboard/chat');

  if (agents.length === 0 || onChatPage) {
    return null;
  }

  return <ChatBubbleInner agents={agents} />;
}

type ChatBubbleInnerProps = {
  /** Guaranteed non-empty by the `ChatBubble` wrapper above. */
  agents: AgentOption[];
};

/**
 * Everything the floating widget actually renders once we know there's at
 * least one agent to chat with. Visual state (hidden / normal / maximized)
 * is client-chrome only, persisted to localStorage — the conversation
 * content itself comes from `useChatSession`, which is the same hook the
 * full-page `/dashboard/chat` surface uses, so both stay in sync on "last
 * viewed conversation".
 * @param root0 - Component props.
 * @param root0.agents - Agents available to pick from. Never empty — see `ChatBubble`.
 */
function ChatBubbleInner({ agents }: ChatBubbleInnerProps) {
  const [visualState, setVisualState] = useState<VisualState>('hidden');
  const [historyOpen, setHistoryOpen] = useState(false);
  const session = useChatSession({ agents });
  const { position, startDrag, consumeDragClick, dragRef } = useDraggablePosition(POSITION_KEY);

  useEffect(() => {
    // One-time read of a client-only value (localStorage) on mount — can't
    // happen during render because it would mismatch the server-rendered
    // 'hidden' default. Not a derived-state sync loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect
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

  const closePanel = () => {
    setHistoryOpen(false);
    setVisual('hidden');
  };

  useEffect(() => {
    if (visualState === 'hidden') {
      return;
    }
    // Escape is two-step when the history panel is open: first Escape
    // dismisses just the history panel (same as clicking elsewhere would),
    // second Escape (now that history is closed) hides the whole widget
    // back to the trigger button — mirrors how the X button's onClose
    // already collapses both at once, but doesn't surprise a user who only
    // meant to back out of the history list.
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return;
      }
      if (historyOpen) {
        setHistoryOpen(false);
      } else {
        closePanel();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visualState, historyOpen]);

  if (visualState === 'hidden') {
    return (
      <button
        ref={dragRef}
        type="button"
        onPointerDown={startDrag}
        onClick={() => {
          if (consumeDragClick()) {
            return;
          }
          setVisual('normal');
        }}
        aria-label="Open chat"
        title="Drag to move, click to open"
        style={{ right: `${position.right}px`, bottom: `${position.bottom}px`, touchAction: 'none' }}
        className="fixed z-50 flex size-14 cursor-grab items-center justify-center rounded-full bg-brand-amber text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-brand-amber-deep active:cursor-grabbing"
      >
        <MessageCircle className="size-6" aria-hidden="true" />
      </button>
    );
  }

  const panelSizeClass = visualState === 'maximized'
    ? 'h-[85vh] w-[36rem] max-w-[90vw]'
    : 'h-[32rem] w-96 max-w-[90vw]';

  return (
    <div
      ref={dragRef}
      role="dialog"
      aria-label="Chat"
      style={{ right: `${position.right}px`, bottom: `${position.bottom}px` }}
      className={`fixed z-50 flex ${panelSizeClass} flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl`}
    >
      <div className="relative">
        <ChatBubbleHeader
          agentName={session.agent.name}
          agents={agents}
          currentSlug={session.agent.slug}
          onSwitchAgent={session.handleSwitchAgent}
          historyOpen={historyOpen}
          onToggleHistory={() => setHistoryOpen(open => !open)}
          onNewChat={() => {
            session.handleNewChat();
            setHistoryOpen(false);
          }}
          maximized={visualState === 'maximized'}
          onToggleMaximize={() => setVisual(visualState === 'maximized' ? 'normal' : 'maximized')}
          onClose={closePanel}
          onDragStart={startDrag}
        />
        {historyOpen && (
          <ChatBubbleHistoryPanel
            agentSlug={session.agent.slug}
            activeConversationId={session.conversationId}
            onSelect={(id) => {
              void session.handlePickConversation(id);
              setHistoryOpen(false);
            }}
          />
        )}
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        {session.messages.length === 0
          ? (
              <EmptyState
                greeting={session.emptyGreeting}
                suggestions={session.emptyChips}
                suggestionsLoading={session.emptyChipsLoading}
                onPick={session.handlePickSuggestion}
                disabled={!session.booted}
              />
            )
          : (
              <MessageList
                messages={session.messages}
                agentName={session.agent.name}
                streaming={session.isStreaming}
                activity={session.activity}
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
          onSubmit={() => session.sendMessage(session.composerValue)}
          disabled={session.isStreaming || !session.booted}
          streaming={session.isStreaming}
          onStop={session.handleStop}
          placeholder={session.agent.placeholder}
        />
      </div>
    </div>
  );
}
