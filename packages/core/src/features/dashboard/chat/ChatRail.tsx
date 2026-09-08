'use client';

import type { AgentOption } from './types';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AGENT_PREFILL_EVENT, AGENT_SURFACE_EVENT, focusAgentComposer } from './agentSurface';
import { ChatBubbleHeader } from './ChatBubbleHeader';
import { ChatBubbleHistoryPanel } from './ChatBubbleHistoryPanel';
import { ChatComposer } from './ChatComposer';
import { EmptyState } from './EmptyState';
import { HitlGate } from './HitlGate';
import { MessageList } from './MessageList';
import { useChatSession } from './useChatSession';

export type ChatRailState = 'closed' | 'open' | 'wide';

export type ChatRailProps = {
  /** Agents available to pick from — server-loaded, same list the full-page chat uses. Empty array renders nothing. */
  agents: AgentOption[];
  /** SSR-known state from the `vocion_chat_rail` cookie, so the rail paints open without a flash. */
  defaultState?: ChatRailState;
};

export const CHAT_RAIL_COOKIE = 'vocion_chat_rail';
const STATE_KEY = 'vocion_chat_rail_state';

/**
 * Persistent right-rail agent chat, mounted once in the shell as a column
 * beside the page content (the ElevenLabs pattern) — open it on Review, keep
 * it open while you walk Agents, Learnings, Activity. Closed, it renders
 * nothing; the header's Ask button and ⌘J open it. `wide` gives the
 * conversation more room for long replies.
 *
 * Bails to `null` on `/dashboard/chat` (the full-page surface) and on record
 * pages that mount the scoped `ChatDock`, so a page never carries two
 * surfaces: both would consume the same one-shot
 * `sessionStorage['vocion_chat_handoff']` and race the last-viewed pointer.
 * The bail sits one level above the hook so `useChatSession` never mounts
 * there at all.
 * @param props - Rail props.
 * @param props.agents - Agents available to pick from. Empty array renders nothing.
 * @param props.defaultState - SSR-known open/closed state.
 */
export function ChatRail({ agents, defaultState = 'closed' }: ChatRailProps) {
  const pathname = usePathname();
  const onChatPage = pathname === '/dashboard/chat' || pathname.endsWith('/dashboard/chat');
  const onDockPage = /\/gtm\/lead\//.test(pathname);
  if (agents.length === 0 || onChatPage || onDockPage) {
    return null;
  }
  return <ChatRailInner agents={agents} defaultState={defaultState} />;
}

function persist(next: ChatRailState) {
  try {
    localStorage.setItem(STATE_KEY, next);
  } catch { /* storage unavailable */ }
  document.cookie = `${CHAT_RAIL_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

/**
 * Everything the rail renders once there is at least one agent. Visual state
 * is client chrome (localStorage + cookie); the conversation comes from
 * `useChatSession`, the same hook the full-page chat and the dock use.
 * @param props - Inner props.
 * @param props.agents - Never empty — see `ChatRail`.
 * @param props.defaultState - SSR-known state.
 */
function ChatRailInner({ agents, defaultState }: { agents: AgentOption[]; defaultState: ChatRailState }) {
  const [state, setState] = useState<ChatRailState>(defaultState);
  const [historyOpen, setHistoryOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const session = useChatSession({ agents });

  const setRail = (next: ChatRailState) => {
    setState(next);
    persist(next);
  };

  // The rail is this page's agent surface: claim entry-point requests by
  // opening and focusing the composer; accept a prefill from the palette.
  useEffect(() => {
    function onRequest(e: Event) {
      e.preventDefault();
      setState(prev => (prev === 'closed' ? 'open' : prev));
      persist('open');
      focusAgentComposer(rootRef.current);
    }
    function onPrefill(e: Event) {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (text) {
        session.setComposerValue(text);
        focusAgentComposer(rootRef.current);
      }
    }
    window.addEventListener(AGENT_SURFACE_EVENT, onRequest);
    window.addEventListener(AGENT_PREFILL_EVENT, onPrefill);
    return () => {
      window.removeEventListener(AGENT_SURFACE_EVENT, onRequest);
      window.removeEventListener(AGENT_PREFILL_EVENT, onPrefill);
    };
    // session.setComposerValue is a stable setter from the hook.
  }, []);

  if (state === 'closed') {
    return null;
  }

  const widthClass = state === 'wide' ? 'md:w-[34rem]' : 'md:w-[24rem]';

  return (
    <aside
      ref={rootRef}
      aria-label="Agent chat"
      className={`fixed inset-y-0 right-0 z-40 flex w-full max-w-full flex-col border-l border-border bg-background shadow-2xl md:static md:z-auto md:h-full md:shrink-0 md:shadow-none ${widthClass}`}
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
          maximized={state === 'wide'}
          onToggleMaximize={() => setRail(state === 'wide' ? 'open' : 'wide')}
          maximizeLabel="Widen"
          restoreLabel="Narrow"
          onClose={() => {
            setHistoryOpen(false);
            setRail('closed');
          }}
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

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
          pastedText={session.pastedText}
          onPasteText={session.setPastedText}
          onClearPasted={() => session.setPastedText(null)}
        />
      </div>
    </aside>
  );
}
