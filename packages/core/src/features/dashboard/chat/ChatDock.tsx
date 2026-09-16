'use client';

import type { AgentSurfaceRequest } from './agentSurface';
import type { AgentOption } from './types';
import type { ReviewCardRun } from '@/features/review/ReviewActionCard';
import type { PageContext } from '@/services/chat/pageContext';
import { MessageSquare, PanelRightClose, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CommentChips } from '@/features/comments/AnchoredComments';
import { useCommentLayer } from '@/features/comments/CommentLayer';
import { useGuidedReview } from '@/features/personalization/GuidedReview';
import { GuidedReviewPanel } from '@/features/personalization/GuidedReviewPanel';
import { AGENT_SURFACE_EVENT, agentSurfaceRequestOf, focusAgentComposer } from './agentSurface';
import { AutonomyControl } from './AutonomyControl';
import { ChatComposer } from './ChatComposer';
import { ChatMenu } from './ChatMenu';
import { useComposerQueueProps } from './composerQueue';
import { publishDockOpen } from './dockState';
import { EmptyState } from './EmptyState';
import { HistoryPopover } from './HistoryPopover';
import { HitlGate } from './HitlGate';
import { MessageList } from './MessageList';
import {
  clampRailWidth,
  defaultRailWidth,
  RAIL_COMPACT_HEADER_WIDTH,
  RAIL_MAX_FRACTION,
  RAIL_MIN_WIDTH,
  RAIL_SHEET_BREAKPOINT,
  readCollapsed,
  readStoredRailWidth,
  writeCollapsed,
  writeStoredRailWidth,
} from './railState';
import { parseSearchCommand } from './routing';
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
  pageContext?: PageContext;
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
  // The surface listener is bound once; it reads collapse state through a ref
  // so a toggle request always sees the rail's current state. Written in an
  // effect rather than during render — the same shape `sessionRef` below uses,
  // and what react-hooks/refs asks for. Safe here because the only reader is
  // the DOM event handler, which cannot run before the commit that set it.
  const collapsedRef = useRef(collapsed);
  useEffect(() => {
    collapsedRef.current = collapsed;
  }, [collapsed]);
  const [width, setWidth] = useState<number>(() => defaultRailWidth(1440));
  // Intent a page affordance handed us (R4): a prompt to prefill and the
  // record / passage it is about. Cleared once a turn goes out. The record
  // the page declares can be dismissed for this dock session ("About: …" chip).
  const [intent, setIntent] = useState<AgentSurfaceRequest | null>(null);
  const [recordDismissed, setRecordDismissed] = useState(false);
  const effectiveContext = useMemo<PageContext | undefined>(() => {
    const base = pageContext ? { ...pageContext } : undefined;
    if (base && recordDismissed) {
      delete base.record;
    }
    const c = intent?.context;
    if (!c) {
      return base;
    }
    return {
      path: base?.path ?? c.path,
      title: base?.title ?? c.title,
      ...(c.record ?? base?.record ? { record: c.record ?? base?.record } : {}),
      ...(c.selection ? { selection: c.selection } : {}),
      ...(c.refs ? { refs: c.refs } : {}),
      openedFrom: true as const,
    };
  }, [pageContext, intent, recordDismissed]);
  const session = useChatSession({ agents, scopeRef, pageContext: effectiveContext, resumeConversationId });
  const queueProps = useComposerQueueProps(session);
  const tagSearch = useTagSearch(agents);
  // Latest session for the request listener (registered once, on mount).
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  });
  const asideRef = useRef<HTMLElement | null>(null);
  const narrow = useNarrowViewport();
  // A turn went out: the intent has been consumed.
  const turnCount = session.messages.length;
  useEffect(() => {
    // Reset keyed on the turn count — the same shape PageDock uses for its title.
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect
    setIntent(null);
  }, [turnCount]);
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
      const req = agentSurfaceRequestOf(e);
      // A toggle request with nothing to apply closes an open rail, so the
      // titlebar control is one button that both opens and collapses. A
      // request carrying intent always opens — someone asking about a record
      // means to talk, never to close.
      if (req.toggle && !collapsedRef.current && req.prompt === undefined && !req.context) {
        setCollapsed(true);
        writeCollapsed(true);
        sessionRef.current.persistRail({ railOpen: false });
        return;
      }
      setCollapsed(false);
      writeCollapsed(false);
      sessionRef.current.persistRail({ railOpen: true });
      // Intent (R4): prefill the composer and attach the record / passage the
      // affordance named — one surface, never a second input on the page.
      if (req.prompt !== undefined || req.context) {
        setIntent(req);
        setRecordDismissed(false);
        if (req.prompt !== undefined) {
          sessionRef.current.setComposerValue(req.prompt);
        }
        if (req.send && req.prompt?.trim()) {
          void sessionRef.current.sendMessage(req.prompt);
        }
      }
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
  // Below this the header has room for the title and four 32px controls, but
  // not for the rung's label beside them — the chip drops to its icon and the
  // tooltip carries the words. Read from the width the rail already tracks
  // rather than a media query, because the rail's width is not the
  // viewport's; the phone sheet is always compact.
  const compact = narrow || width < RAIL_COMPACT_HEADER_WIDTH;

  // ONE identity (§9.10): unscoped, the rail is titled by the workspace's
  // name with its initial as the mark; scoped, by the record it is about.
  const workspaceKnown = agents.some(a => a.workspaceName);
  const headerName = scopeRef ? scopeLabel : (workspaceKnown ? session.workspaceName : scopeLabel);

  const body = (
    <>
      {/* ONE hairline-separated row, 48px tall (2026-09-15): the workspace
          mark + its name as the title, then four equal 32px ghost controls —
          history, the autonomy rung, the ⋯ menu, collapse. The underlined
          "All conversations" link that used to sit under the title read as an
          error; it is a row in the ⋯ menu now, and the history icon carries
          the job it was doing. */}
      {/* In the sheet the close control is absolutely positioned in this
          corner, so the row keeps clear of it rather than stacking under it. */}
      <div className={`flex h-12 shrink-0 items-center gap-1 border-b border-border pl-3 ${narrow ? 'pr-11' : 'pr-1.5'}`}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {!scopeRef && (
            <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-md bg-brand-amber-tint text-[11px] font-semibold text-brand-amber-deep">
              {headerName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="truncate text-sm font-semibold">{headerName}</span>
          {/* Scoped: the workspace agent is who answers about this record.
              Unscoped the header already IS the workspace — no agent name
              ever appears here (§9.10). */}
          {scopeRef && workspaceKnown && !compact && (
            <span className="truncate text-xs text-muted-foreground">{session.workspaceName}</span>
          )}
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
        {/* The conversation's rung — a setting, so it lives beside the
            conversation's name and not inside the composer (§9.7). */}
        <AutonomyControl
          value={session.autonomy}
          onChange={session.setAutonomy}
          copy={autonomyCopy}
          label={t('autonomy')}
        />
        {/* New chat + all conversations. There is no agent to pick (§9.10). */}
        <ChatMenu onNewChat={session.handleNewChat} />
        {/* The sheet carries its own close control in this corner; a second
            one underneath it was two buttons in one 32px square. */}
        {!narrow && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setCollapsedPersisted(true)}
                aria-label={t('collapse_rail')}
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <PanelRightClose className="size-4" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end" collisionPadding={8}>{t('collapse_rail')}</TooltipContent>
          </Tooltip>
        )}
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
                agentName={session.workspaceName}
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

        {effectiveContext?.record && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5" data-testid="dock-context-chips">
            <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground">
              <span className="shrink-0">About:</span>
              <span className="truncate font-medium text-foreground/85">{effectiveContext.record.label ?? `${effectiveContext.record.type.replace('_', ' ')} ${effectiveContext.record.id}`}</span>
              <button
                type="button"
                aria-label="Ask without this record"
                title="Ask without this record"
                onClick={() => {
                  setRecordDismissed(true);
                  setIntent(i => (i ? { ...i, context: i.context ? { ...i.context, record: undefined } : undefined } : i));
                }}
                className="ml-0.5 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
            {effectiveContext.selection && (
              <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground italic">
                <span className="truncate">
                  “
                  {effectiveContext.selection.text}
                  ”
                </span>
                <button
                  type="button"
                  aria-label="Remove the quoted passage"
                  onClick={() => setIntent(i => (i?.context ? { ...i, context: { ...i.context, selection: undefined } } : i))}
                  className="ml-0.5 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            )}
          </div>
        )}
        <ChatComposer
          value={session.composerValue}
          onChange={session.setComposerValue}
          onSubmit={() => void sendWithComments()}
          // Streaming no longer disables anything — Enter queues instead.
          // Boot still does: a message sent before the thread resolves would
          // be discarded when the restored transcript lands.
          disabled={!session.booted}
          streaming={session.isStreaming}
          {...queueProps}
          onStop={session.handleStop}
          placeholder={session.composerPlaceholder}
          commandHint={parseSearchCommand(session.composerValue).searchOnly ? t('search_mode') : undefined}
          armed={(comments?.open.length ?? 0) > 0}
          pastedText={session.pastedText}
          onPasteText={session.setPastedText}
          onClearPasted={() => session.setPastedText(null)}
          tags={session.contextRefs}
          onAddTag={session.addContextRef}
          onRemoveTag={session.removeContextRef}
          tagSearch={tagSearch}
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
            {/* One identity (§9.10): the sheet is described as the workspace, never an agent. */}
            <SheetDescription>{headerName}</SheetDescription>
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
