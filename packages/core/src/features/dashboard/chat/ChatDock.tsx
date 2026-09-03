'use client';

import type { AgentOption } from './types';
import type { ReviewCardRun } from '@/features/review/ReviewActionCard';
import { MessageCircle, PanelRightClose } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CommentChips } from '@/features/comments/AnchoredComments';
import { useCommentLayer } from '@/features/comments/CommentLayer';
import { useGuidedReview } from '@/features/personalization/GuidedReview';
import { GuidedReviewPanel } from '@/features/personalization/GuidedReviewPanel';
import { Link } from '@/libs/I18nNavigation';
import { AGENT_SURFACE_EVENT, focusAgentComposer } from './agentSurface';
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
  /**
   * A decision waiting on this record. Given one, the dock runs the guided
   * review: the sends walked one card at a time, decided here (050).
   */
  run?: ReviewCardRun | null;
  /** Fired after a guided decision lands, so the page can re-resolve. */
  onDecided?: () => void;
};

const COLLAPSE_KEY = 'vocion_chat_dock_collapsed';

/**
 * Stands in when no decision is waiting. Hooks cannot be called
 * conditionally, and a card with no content yields no sends, so the guided
 * flow simply has nothing to walk.
 */
const EMPTY_RUN = {
  id: 0,
  actionId: '',
  status: 'pending',
  input: {},
  invokedBy: null,
  proposal: null,
  card: { title: '', fields: [] },
} as unknown as ReviewCardRun;

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
 * @param root0.run
 * @param root0.onDecided
 */
export function ChatDock({ agents, scopeRef, scopeLabel, run, onDecided }: ChatDockProps) {
  if (agents.length === 0) {
    return null;
  }
  return <ChatDockInner agents={agents} scopeRef={scopeRef} scopeLabel={scopeLabel} run={run} onDecided={onDecided} />;
}

/**
 * The dock body — split from the wrapper so `useChatSession` (and its mount
 * effects) never runs when there are no agents to talk to, the same guarantee
 * `ChatBubble` makes.
 * @param root0 - Component props.
 * @param root0.agents - Guaranteed non-empty by the `ChatDock` wrapper.
 * @param root0.scopeRef - The record this dock is scoped to.
 * @param root0.scopeLabel - Human name of the scope for the header.
 * @param root0.run
 * @param root0.onDecided
 */
function ChatDockInner({ agents, scopeRef, scopeLabel, run, onDecided }: ChatDockProps) {
  // Default OPEN (the decision), collapsed only by the user's own hand;
  // the choice persists per browser like the bubble's visual state does.
  const [collapsed, setCollapsed] = useState(false);
  const session = useChatSession({ agents, scopeRef });
  const asideRef = useRef<HTMLElement | null>(null);
  // The page's comment layer, when it has one: notes taken on the document
  // beside this dock ride out with the next message (043).
  const comments = useCommentLayer();
  // Guided review, when a decision is waiting on this record (050).
  const guided = useGuidedReview({
    run: run ?? EMPTY_RUN,
    ...(onDecided ? { onDecided } : {}),
  });

  // The dock IS this page's agent surface: claim any entry-point request
  // (hotkey, titlebar, rail) by un-collapsing and taking focus (032 §6).
  useEffect(() => {
    function onRequest(e: Event) {
      e.preventDefault();
      setCollapsed(false);
      try {
        localStorage.setItem(COLLAPSE_KEY, '0');
      } catch {
        /* storage unavailable */
      }
      focusAgentComposer(asideRef.current);
    }
    window.addEventListener(AGENT_SURFACE_EVENT, onRequest);
    return () => window.removeEventListener(AGENT_SURFACE_EVENT, onRequest);
  }, []);

  useEffect(() => {
    // One-time read of a client-only value (localStorage) on mount — same
    // pattern and same lint carve-out as ChatBubble's visual state.
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect
    setCollapsed(readCollapsed());
  }, []);

  /**
   * Send the message with any anchored notes attached, then mark them
   * applied — the highlights clear because the change landed, not on a
   * timer (043). Sending nothing but notes still sends: the notes ARE the
   * instruction.
   */
  const sendWithComments = async () => {
    const pendingNotes = comments?.open ?? [];
    const typed = session.composerValue.trim();
    if (!typed && pendingNotes.length === 0) {
      return;
    }
    // A revision ask goes to the drafting path, which re-presents the send it
    // changed; a question goes to the agent like any other. Both appear in
    // the transcript, so the record of the review is one conversation.
    const asked = run && typed ? await guided.askAbout(typed) : null;
    if (asked?.kind === 'revised') {
      session.setComposerValue('');
      return;
    }
    const quoted = pendingNotes
      .map((c, i) => `${i + 1}. “${c.anchor.quote}” — ${c.note}`)
      .join('\n');
    const text = pendingNotes.length > 0
      ? `${typed || 'Apply these changes.'}\n\n--- on the brief ---\n${quoted}`
      : typed;
    await session.sendMessage(text);
    if (pendingNotes.length > 0) {
      await comments?.applyComments(pendingNotes.map(c => c.id));
    }
  };

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
      ref={asideRef}
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
        {/* Kept mounted after a decision so the outcome card can state what
            happened — hiding the flow the moment it is decided would drop the
            one card that says so. Sits under the scope header, above the
            transcript: the cards are the work at hand, the history scrolls
            beneath them. */}
        {run && (!guided.state.decided || guided.outcome) && (
          <div className="max-h-[55%] shrink-0 overflow-y-auto border-b border-border bg-muted/20">
            <GuidedReviewPanel run={run} guided={guided} />
          </div>
        )}

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

        {comments && (
          <CommentChips
            comments={comments.open}
            activeId={comments.activeId}
            onFocus={comments.focusComment}
            onRemove={id => void comments.removeComment(id)}
          />
        )}

        <ChatComposer
          value={session.composerValue}
          onChange={session.setComposerValue}
          onSubmit={() => void sendWithComments()}
          disabled={session.isStreaming || !session.booted}
          streaming={session.isStreaming}
          onStop={session.handleStop}
          placeholder={session.agent.placeholder}
          armed={(comments?.open.length ?? 0) > 0}
          pastedText={session.pastedText}
          onPasteText={session.setPastedText}
          onClearPasted={() => session.setPastedText(null)}
        />
      </div>
    </aside>
  );
}
