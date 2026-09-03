'use client';

import type { AgentOption } from './types';
import { MessageCircle, PanelRightClose } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from '@/libs/I18nNavigation';
import { ChatComposer } from './ChatComposer';
import { EmptyState } from './EmptyState';
import { HitlGate } from './HitlGate';
import { MessageList } from './MessageList';
import { useChatSession } from './useChatSession';

export type ChatDockProps = {
  /** Agents available to pick from — server-loaded, same list every chat surface uses. Empty array renders nothing. */
  agents: AgentOption[];
  /** The record this dock is scoped to — the CRM mirror ref (e.g. `contacts:9412`). */
  scopeRef: string;
  /** Human name of the scope for the header (e.g. the lead's name). */
  scopeLabel: string;
};

const COLLAPSE_KEY = 'vocion_chat_dock_collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The dock — the agent conversation as a third column on a record page
 * (agent-chat-surface.md §3, decided 2026-09-02: a core component, defaulting
 * to open, collapsible; the full-page chat stays as the everything scope).
 *
 * Same brain as the other two surfaces (`useChatSession`), scoped: it resumes
 * the current user's latest conversation FOR THIS RECORD, creates
 * conversations carrying the scope, and never touches the global last-viewed
 * pointers, so it cannot steal the full-page chat's thread. Below 1200px the
 * dock covers the page instead of narrowing it (032 §3.2).
 *
 * Mounted by the record page (which knows its scope), not by the shell; the
 * floating `ChatBubble` bails out on dock routes so a page never carries two
 * chat surfaces (032 §6).
 * @param root0 - Component props.
 * @param root0.agents - Agents available to pick from. Empty array renders nothing.
 * @param root0.scopeRef - The record this dock is scoped to.
 * @param root0.scopeLabel - Human name of the scope for the header.
 */
export function ChatDock({ agents, scopeRef, scopeLabel }: ChatDockProps) {
  if (agents.length === 0) {
    return null;
  }
  return <ChatDockInner agents={agents} scopeRef={scopeRef} scopeLabel={scopeLabel} />;
}

/**
 * The dock body — split from the wrapper so `useChatSession` (and its mount
 * effects) never runs when there are no agents to talk to, the same guarantee
 * `ChatBubble` makes.
 * @param root0 - Component props.
 * @param root0.agents - Guaranteed non-empty by the `ChatDock` wrapper.
 * @param root0.scopeRef - The record this dock is scoped to.
 * @param root0.scopeLabel - Human name of the scope for the header.
 */
function ChatDockInner({ agents, scopeRef, scopeLabel }: ChatDockProps) {
  // Default OPEN (the decision), collapsed only by the user's own hand;
  // the choice persists per browser like the bubble's visual state does.
  const [collapsed, setCollapsed] = useState(false);
  const session = useChatSession({ agents, scopeRef });

  useEffect(() => {
    // One-time read of a client-only value (localStorage) on mount — same
    // pattern and same lint carve-out as ChatBubble's visual state.
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect
    setCollapsed(readCollapsed());
  }, []);

  const setCollapsedPersisted = (next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      /* storage unavailable — state still holds for this session */
    }
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsedPersisted(false)}
        aria-label="Open the conversation"
        title="Open the conversation"
        className="fixed right-4 bottom-4 z-40 flex size-12 items-center justify-center rounded-full bg-brand-amber text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-brand-amber-deep"
      >
        <MessageCircle className="size-5" aria-hidden="true" />
      </button>
    );
  }

  return (
    <aside
      aria-label={`Conversation about ${scopeLabel}`}
      className="sticky top-0 z-30 flex h-screen w-96 shrink-0 flex-col border-l border-border bg-background max-[1199px]:fixed max-[1199px]:inset-y-0 max-[1199px]:right-0 max-[1199px]:shadow-2xl"
    >
      {/* Scope header — names what this conversation is about, with the one
          link back to everything (032 §3.1). */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{scopeLabel}</div>
          <div className="truncate text-xs text-muted-foreground">
            {session.agent.name}
            {' · '}
            <Link href="/dashboard/chat" className="underline underline-offset-2 hover:text-foreground">
              All conversations
            </Link>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCollapsedPersisted(true)}
          aria-label="Collapse the conversation"
          title="Collapse"
          className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <PanelRightClose className="size-4" aria-hidden="true" />
        </button>
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
    </aside>
  );
}
