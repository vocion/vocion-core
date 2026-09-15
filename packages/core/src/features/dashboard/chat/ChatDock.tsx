'use client';

import type { AgentOption } from './types';
import type { ReviewCardRun } from '@/features/review/ReviewActionCard';
import { MessageSquare, PanelRightClose } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { CommentChips } from '@/features/comments/AnchoredComments';
import { useCommentLayer } from '@/features/comments/CommentLayer';
import { useGuidedReview } from '@/features/personalization/GuidedReview';
import { GuidedReviewPanel } from '@/features/personalization/GuidedReviewPanel';
import { Link } from '@/libs/I18nNavigation';
import { AGENT_SURFACE_EVENT, focusAgentComposer } from './agentSurface';
import { ChatComposer } from './ChatComposer';
import { ChatMenu } from './ChatMenu';
import { publishDockOpen } from './dockState';
import { EmptyState } from './EmptyState';
import { HistoryPopover } from './HistoryPopover';
import { HitlGate } from './HitlGate';
import { MessageList } from './MessageList';
import {
  clampRailWidth,
  defaultRailWidth,
  RAIL_MAX_FRACTION,
  RAIL_MIN_WIDTH,
  RAIL_SHEET_BREAKPOINT,
  readCollapsed,
  readStoredRailWidth,
  writeCollapsed,
  writeStoredRailWidth,
} from './railState';
import { useTagSearch } from './tagSearch';
import { useChatSession } from './useChatSession';

export type ChatDockProps = {
  /** Agents available to pick from — server-loaded, same list every chat surface uses. Empty array renders nothing. */
  agents: AgentOption[];
  /**
   * The record this dock is scoped to — the CRM mirror ref (e.g. `contacts:9412`).
   * Absent, the dock is the everything conversation (058), the same thread the
   * full page resumes, with `pageContext` saying where the person is.
   */
  scopeRef?: string;
  /** Human name of the scope for the header (e.g. the lead's name, or "Everything"). */
  scopeLabel: string;
  /** Where the person is, sent with each turn when the dock is not record-scoped (058). */
  pageContext?: { path: string; title: string };
  /**
   * How the rail starts when this browser has never collapsed or opened one:
   * open on a record (the decision is the point), collapsed to the edge tab
   * everywhere else (058). A stored choice wins over this.
   */
  defaultCollapsed?: boolean;
  /**
   * A decision waiting on this record. Given one, the dock runs the guided
   * review: the sends walked one card at a time, decided here (050).
   */
  run?: ReviewCardRun | null;
  /** Fired after a guided decision lands, so the page can re-resolve. */
  onDecided?: () => void;
  /** A thread the URL names (`?conversation=<id>`) — resume it instead of starting fresh (§9). */
  resumeConversationId?: number | null;
};

/**
 * Kept for callers and tests that read the legacy constant: the rail's
 * width is now a pixel value (see `railState.ts`), not a class.
 * @deprecated Width is stateful since §9; this is the default open width's class equivalent.
 */
export const DOCK_WIDTH_CLASS = 'w-[max(24rem,33.333vw)]';

/**
 * A question that asks for the review cards back (058). The cards live inline
 * in the transcript and scroll away with it; asking where you were, or what is
 * left to decide, brings them back to the bottom. Matched on the client so
 * the cards move at once; the question still goes to the agent, who answers
 * it in words as well.
 * @param text - What the person typed.
 */
export function isRecallAsk(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /\b(?:what (?:do|should|did) i (?:still )?(?:need|have) to (?:review|decide|approve|look at)|what(?:'s| is) (?:left|pending|waiting|outstanding)(?: to (?:review|decide))?|where (?:was|am) i|show (?:me )?(?:the |my )?(?:review )?(?:cards?|sends?|review)|(?:bring|pull) (?:the |my )?(?:cards?|review) (?:back|up)|what do i (?:need to )?review)\b/.test(t);
}

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

/**
 * Whether the viewport is too narrow for a side-by-side rail — below the
 * breakpoint the rail covers the page as a sheet instead of narrowing it.
 */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${RAIL_SHEET_BREAKPOINT - 1}px)`);
    const onChange = () => setNarrow(mql.matches);
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect
    setNarrow(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

/**
 * The rail — the agent conversation as a persistent, resizable third column
 * beside every page (agent-chat-surface.md §3, §9): a core component,
 * collapsible to a slim edge tab, toggled with ⌘J, its width remembered per
 * user. The full-page chat stays as the everything scope.
 *
 * Same brain as the other surfaces (`useChatSession`). Record-scoped, it
 * resumes the current user's latest conversation FOR THIS RECORD; everything-
 * scoped, it opens a NEW conversation unless this browser session was already
 * in one or the URL names one (§9). Below 1200px the rail covers the page as
 * a sheet instead of narrowing it.
 *
 * Mounted once by the shell (`PageDock`) or by a record page that knows its
 * scope; the shell's dock bails out on those routes so a page never carries
 * two conversation surfaces (§6).
 * @param root0 - Component props.
 * @param root0.agents - Agents available to pick from. Empty array renders nothing.
 * @param root0.scopeRef - The record this dock is scoped to.
 * @param root0.scopeLabel - Human name of the scope for the header.
 * @param root0.pageContext
 * @param root0.defaultCollapsed
 * @param root0.run
 * @param root0.onDecided
 * @param root0.resumeConversationId
 */
export function ChatDock({ agents, scopeRef, scopeLabel, pageContext, defaultCollapsed, run, onDecided, resumeConversationId }: ChatDockProps) {
  if (agents.length === 0) {
    return null;
  }
  return <ChatDockInner agents={agents} scopeRef={scopeRef} scopeLabel={scopeLabel} pageContext={pageContext} defaultCollapsed={defaultCollapsed} run={run} onDecided={onDecided} resumeConversationId={resumeConversationId} />;
}

/**
 * The rail body — split from the wrapper so `useChatSession` (and its mount
 * effects) never runs when there are no agents to talk to, the same guarantee
 * `PageDock` makes.
 * @param root0 - Component props.
 * @param root0.agents - Guaranteed non-empty by the `ChatDock` wrapper.
 * @param root0.scopeRef - The record this dock is scoped to.
 * @param root0.scopeLabel - Human name of the scope for the header.
 * @param root0.pageContext
 * @param root0.defaultCollapsed
 * @param root0.run
 * @param root0.onDecided
 * @param root0.resumeConversationId
 */
function ChatDockInner({ agents, scopeRef, scopeLabel, pageContext, defaultCollapsed = false, run, onDecided, resumeConversationId = null }: ChatDockProps) {
  const t = useTranslations('Chat');
  // Starts as the page says (open on a record, collapsed elsewhere) until the
  // person collapses or opens one; that choice persists per browser (and per
  // user, server-side) and applies on every page (058, §9).
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [width, setWidth] = useState<number>(() => defaultRailWidth(1440));
  const session = useChatSession({ agents, scopeRef, pageContext, resumeConversationId });
  const tagSearch = useTagSearch(agents);
  const asideRef = useRef<HTMLElement | null>(null);
  const narrow = useNarrowViewport();
  // The page's comment layer, when it has one: notes taken on the document
  // beside this dock ride out with the next message (043).
  const comments = useCommentLayer();
  // Guided review, when a decision is waiting on this record (050).
  const guided = useGuidedReview({
    run: run ?? EMPTY_RUN,
    ...(onDecided ? { onDecided } : {}),
  });
  // Where in the transcript the guided cards sit (058): the index of the
  // message they follow, -1 for the top. A revision or a recall moves them to
  // the bottom; the cards are one live block, never duplicated.
  const [cardAnchor, setCardAnchor] = useState(-1);
  const lastMessageIndex = session.messages.length - 1;
  const cardsScrolledAway = cardAnchor < lastMessageIndex;
  const recallCards = () => setCardAnchor(lastMessageIndex);

  const setCollapsedPersisted = useCallback((next: boolean) => {
    setCollapsed(next);
    writeCollapsed(next);
    session.persistRail({ railOpen: !next });
  }, [session]);

  // The rail IS this page's agent surface: claim any entry-point request
  // (hotkey, titlebar, a page's "Ask about this") by opening and taking
  // focus (§6).
  useEffect(() => {
    function onRequest(e: Event) {
      e.preventDefault();
      setCollapsed(false);
      writeCollapsed(false);
      focusAgentComposer(asideRef.current);
    }
    window.addEventListener(AGENT_SURFACE_EVENT, onRequest);
    return () => window.removeEventListener(AGENT_SURFACE_EVENT, onRequest);
  }, []);

  // ⌘J / Ctrl+J toggles the rail (§9). Bound here — not in the shell's
  // hotkey component — because the rail is the thing being toggled.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'j' || e.defaultPrevented) {
        return;
      }
      e.preventDefault();
      setCollapsed((prev) => {
        const next = !prev;
        writeCollapsed(next);
        if (!next) {
          focusAgentComposer(asideRef.current);
        }
        return next;
      });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // One-time read of client-only values (localStorage, viewport) on mount; it
  // cannot happen during render because it would mismatch the server render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect
    setCollapsed(readCollapsed(defaultCollapsed));
    const stored = readStoredRailWidth();
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setWidth(clampRailWidth(stored ?? defaultRailWidth(window.innerWidth), window.innerWidth));
  }, [defaultCollapsed]);

  // A second device: adopt the server-side geometry when this browser has
  // never said anything itself.
  const railState = session.railState;
  useEffect(() => {
    if (!railState) {
      return;
    }
    if (readStoredRailWidth() === null && typeof railState.railWidth === 'number') {
      const w = clampRailWidth(railState.railWidth, window.innerWidth);
      // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect
      setWidth(w);
      writeStoredRailWidth(w);
    }
    let storedCollapse: string | null = null;
    try {
      storedCollapse = localStorage.getItem('vocion_chat_dock_collapsed');
    } catch {
      /* storage unavailable */
    }
    if (storedCollapse === null && typeof railState.railOpen === 'boolean') {
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
      setCollapsed(!railState.railOpen);
    }
  }, [railState]);

  // Drag the left edge to resize. Pointer capture keeps the drag alive when
  // the cursor leaves the handle; the width persists on release only, so a
  // drag is one write, not hundreds.
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { startX: e.clientX, startWidth: width };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) {
      return;
    }
    setWidth(clampRailWidth(d.startWidth + (d.startX - e.clientX), window.innerWidth));
  };
  const onResizeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) {
      return;
    }
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    writeStoredRailWidth(width);
    session.persistRail({ railWidth: width });
  };
  const onResizeKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next = clampRailWidth(width + (e.key === 'ArrowLeft' ? step : -step), window.innerWidth);
      setWidth(next);
      writeStoredRailWidth(next);
      session.persistRail({ railWidth: next });
    }
  };

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
      // The revised send is re-presented where the reviewer is looking: the
      // bottom of the transcript.
      recallCards();
      return;
    }
    // "What do I need to review?" brings the cards back under the answer the
    // agent is about to give: the send adds a user turn and a reply, so the
    // cards follow the reply.
    if (run && typed && isRecallAsk(typed)) {
      setCardAnchor(session.messages.length + 1);
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

  // Tell the page beside the rail whether it has the room (the review queue
  // folds its Up-next rail while the rail is open). Closed again on unmount.
  useEffect(() => {
    publishDockOpen(!collapsed && !narrow);
    return () => publishDockOpen(false);
  }, [collapsed, narrow]);

  const showCards = run && (!guided.state.decided || guided.outcome);
  const cardBlocks = showCards
    ? [{
        key: 'guided',
        afterIndex: Math.min(cardAnchor, Math.max(lastMessageIndex, -1)),
        node: (
          <div className="rounded-xl border border-border bg-muted/20">
            <GuidedReviewPanel run={run} guided={guided} pendingComments={comments?.open.length ?? 0} />
          </div>
        ),
      }]
    : [];

  const autonomyCopy = {
    ask: t('autonomy_ask'),
    act: t('autonomy_act'),
    askHint: t('autonomy_ask_hint'),
    actHint: t('autonomy_act_hint'),
  };

  const body = (
    <>
      {/* Scope header — names what this conversation is about, with the one
          link back to everything (032 §3.1), the history, and the collapse. */}
      <div className="flex items-center gap-1 border-b border-border px-3 py-2.5 pl-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{scopeLabel}</span>
            {session.autonomy === 'act-within-bounds' && (
              <span data-testid="autonomy-chip" title={autonomyCopy.actHint} className="shrink-0 rounded-full border border-brand-amber/40 bg-brand-amber-tint px-1.5 py-0.5 text-[10px] font-medium text-brand-amber-deep">
                {autonomyCopy.act}
              </span>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {session.agent.name}
            {' · '}
            <Link href="/dashboard/chat" className="underline underline-offset-2 hover:text-foreground">
              {t('all_conversations')}
            </Link>
          </div>
        </div>
        {!scopeRef && (
          <HistoryPopover
            recent={session.recentChats}
            currentId={session.conversationId}
            onPick={id => void session.handlePickConversation(id)}
            onNewChat={session.handleNewChat}
            search={session.searchConversations}
          />
        )}
        {/* New chat + which agent answers. History moved to its own popover. */}
        <ChatMenu
          onNewChat={session.handleNewChat}
          agents={agents}
          currentSlug={session.agent.slug}
          onSwitch={session.handleSwitchAgent}
        />
        <button
          type="button"
          onClick={() => setCollapsedPersisted(true)}
          aria-label={t('collapse_rail')}
          title={t('collapse_rail')}
          className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <PanelRightClose className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* The guided cards live in the transcript, at `cardAnchor` (058). Kept
            mounted after a decision so the outcome card can state what
            happened — hiding the flow the moment it is decided would drop the
            one card that says so. */}
        {session.messages.length === 0 && cardBlocks.length === 0
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
                blocks={cardBlocks}
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

        {/* The cards have scrolled up behind newer turns: one click brings
            them back to the bottom, the same as asking for them (058). */}
        {run && !guided.state.decided && cardsScrolledAway && (
          <div className="px-4 pt-2 sm:px-6">
            <button
              type="button"
              onClick={recallCards}
              className="rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground/80 transition hover:bg-muted"
            >
              Show my review cards
            </button>
          </div>
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
          tags={session.contextRefs}
          onAddTag={session.addContextRef}
          onRemoveTag={session.removeContextRef}
          tagSearch={tagSearch}
          autonomy={session.autonomy}
          onAutonomyChange={session.setAutonomy}
          autonomyCopy={autonomyCopy}
        />
      </div>
    </>
  );

  const ariaLabel = scopeRef ? t('rail_label_about', { scope: scopeLabel }) : t('rail_label');

  if (collapsed) {
    // The edge tab: a slim handle on the right edge, not a floating bubble
    // (§9). Click or ⌘J opens.
    return (
      <button
        type="button"
        onClick={() => setCollapsedPersisted(false)}
        aria-label={t('open_rail')}
        title={t('open_rail')}
        data-testid="rail-edge-tab"
        className="fixed top-1/2 right-0 z-40 flex -translate-y-1/2 flex-col items-center gap-2 rounded-l-xl border border-r-0 border-border bg-background px-1.5 py-3 text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
      >
        <MessageSquare className="size-4" aria-hidden="true" />
        <span className="text-[10px] font-medium tracking-wide [writing-mode:vertical-rl]">Chat</span>
      </button>
    );
  }

  if (narrow) {
    // Below the breakpoint the rail covers the page as a sheet instead of
    // narrowing it (032 §3.2).
    return (
      <Sheet open onOpenChange={open => setCollapsedPersisted(!open)}>
        <SheetContent side="right" className="flex w-full max-w-[28rem] flex-col gap-0 p-0 sm:max-w-[28rem]" aria-label={ariaLabel}>
          <SheetHeader className="sr-only">
            <SheetTitle>{ariaLabel}</SheetTitle>
            <SheetDescription>{session.agent.name}</SheetDescription>
          </SheetHeader>
          <div ref={asideRef as React.RefObject<HTMLDivElement>} className="flex min-h-0 flex-1 flex-col">
            {body}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside
      ref={asideRef}
      aria-label={ariaLabel}
      data-testid="agent-rail"
      style={{ width }}
      // Under the sticky 4rem header, the rest of the viewport: the composer
      // is always the bottom edge of the pane (058).
      className="relative sticky top-16 z-30 flex h-[calc(100dvh-4rem)] shrink-0 flex-col border-l border-border bg-background"
    >
      {/* The resize handle on the rail's left edge (§9): drag, or arrow keys
          when focused. */}
      <div
        role="slider"
        aria-label={t('resize_rail')}
        aria-valuemin={RAIL_MIN_WIDTH}
        aria-valuemax={Math.floor((typeof window === 'undefined' ? 1440 : window.innerWidth) * RAIL_MAX_FRACTION)}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        onKeyDown={onResizeKey}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none transition select-none hover:bg-brand-amber/30 focus-visible:bg-brand-amber/40 focus-visible:outline-none"
      />
      {body}
    </aside>
  );
}
