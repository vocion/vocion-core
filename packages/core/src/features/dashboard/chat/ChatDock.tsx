'use client';

import type { AgentSurfaceRequest } from './agentSurface';
import type { AgentOption } from './types';
import type { ReviewCardRun } from '@/features/review/ReviewSurface';
import type { PageContext } from '@/services/chat/pageContext';
import { MessageSquare, PanelRightClose, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useViewportBelow } from '@/components/ui/useMobile';
import { CommentChips } from '@/features/comments/AnchoredComments';
import { useCommentLayer } from '@/features/comments/CommentLayer';
import { usePageRecord } from '@/features/dashboard/context/PageContextProvider';
import { contentIdForAsk } from '@/features/personalization/guidedFlow';
import { useGuidedReview } from '@/features/personalization/GuidedReview';
import { GuidedReviewPanel } from '@/features/personalization/GuidedReviewPanel';
import { SequencePointer } from '@/features/personalization/SequencePointer';
import { client } from '@/libs/Orpc';
import { pageShowsRecord, scopeRefToRecord } from '@/services/chat/pageContext';
import { AGENT_SURFACE_EVENT, agentSurfaceRequestOf, focusAgentComposer } from './agentSurface';
import { AUTONOMY_SETTING_ID, autonomyFromOption, autonomyMenuSetting } from './autonomyOptions';
import { CardDecisionProvider } from './cards/CardDecisions';
import { ChatComposer } from './ChatComposer';
import { ChatHeaderActions } from './ChatHeaderActions';
import { useComposerQueueProps } from './composerQueue';
import { hasChangeIntent } from './composerTags';
import { RAIL_SET_EVENT } from './dockState';
import { EmptyState, NoAgentsState } from './EmptyState';
import { HitlGate } from './HitlGate';
import { MessageList } from './MessageList';
import { ModelControl } from './ModelControl';
import { RailColumn } from './RailColumn';
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
import { hasWorkspaceAgents, parseSearchCommand } from './routing';
import { useComposerTags } from './tagSearch';
import { transcriptOf } from './transcript';
import { useChatCommands } from './useChatCommands';
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
   * How the rail starts when this browser has never collapsed or opened one.
   *
   * Collapsed to the edge tab, everywhere — a page is full width when you
   * arrive on it (2026-09-16). Left unset it resolves to `!run`: the ONE
   * exception is a record with a DECISION waiting, because the decision is
   * what the person came for and hiding it behind a tab on a page whose
   * masthead says "Ready for review" is not a thing to make somebody discover
   * (058's "the decision is the point", read as being about the decision
   * rather than about the record). A stored choice wins over this.
   */
  defaultCollapsed?: boolean;
  /**
   * A decision waiting on this record.
   *
   * What the rail does with it depends on whether the record is ALREADY on
   * screen (`pageShowsRecord`). Where it is not — the full-page chat — the
   * rail runs the guided review: the sends walked one card at a time, decided
   * here (050). Where it is, the page owns the sends and the verbs and the
   * rail carries only the conversation plus a pointer at them; the run is
   * still needed, because `@change` rewrites against it.
   *
   * Note that the rail's GEOMETRY is unchanged by that split: a decision
   * waiting still opens the rail at the same width (`startCollapsed` below),
   * because the right column's layout is one concern and what goes inside the
   * chat pane is another. Whether a record page should still auto-open the
   * rail now that the decision is on the page belongs with the column work.
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
 *
 * One hook (`components/ui/useMobile`) answers this for every surface that
 * asks; this names the rail's own breakpoint and nothing else.
 */
function useNarrowViewport(): boolean {
  return useViewportBelow(RAIL_SHEET_BREAKPOINT);
}

/**
 * The rail — the agent conversation as a persistent, resizable OVERLAY on the
 * right edge of every page (agent-chat-surface.md §3, §9): a core component,
 * collapsible to a slim edge tab, toggled with ⌘J, its width remembered per
 * user. The full-page chat stays as the everything scope.
 *
 * The page is always full width (2026-09-16). The rail used to be a third
 * column that narrowed the document; Chris asked for full width by default on
 * a record, and an overlay is the form that keeps BOTH his asks: the record is
 * never squeezed, and the conversation is still one keystroke away. It also
 * means opening the rail cannot move the page under a highlighted passage —
 * the select-to-talk pattern and the rail no longer fight each other. See
 * `docs/design/patterns.md`, "Record pages are full width".
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
function ChatDockInner({ agents, scopeRef, scopeLabel, pageContext, defaultCollapsed, run, onDecided, resumeConversationId = null }: ChatDockProps) {
  const t = useTranslations('Chat');
  // THE division of labour (2026-09-16). The record this rail is about, as
  // the page beside it would name it, and then the one question that decides
  // what the rail may draw: is that record ALREADY on screen?
  //
  // The record page owns the record; the rail owns the conversation about it.
  // A rail that re-renders the page's own content is a second copy with no
  // owner — which is exactly what the guided review had become on the lead
  // page (docs/design/patterns.md, "The rail is the conversation, never a
  // second copy of the page"). Read from `pageContext`, not from `intent`:
  // dismissing the "About:" chip changes what the TURN carries, never what is
  // on the screen.
  const railRecord = useMemo(() => (scopeRef ? scopeRefToRecord(scopeRef) : null), [scopeRef]);
  // The page's own declaration (R4 / #329, `<RecordContext record=…>`), which
  // a page that mounts its own dock makes to the shell rather than through
  // this component's props — so nothing is threaded down five components to
  // answer a question the page already answered.
  const { record: declaredRecord } = usePageRecord();
  const surfaceContext = useMemo<PageContext | null>(() => {
    if (!pageContext) {
      return declaredRecord ? { path: '', title: '', record: declaredRecord } : null;
    }
    if (pageContext.record || !declaredRecord) {
      return pageContext;
    }
    return { ...pageContext, record: declaredRecord };
  }, [pageContext, declaredRecord]);
  const recordOnPage = pageShowsRecord(surfaceContext, railRecord);
  // The rail runs the review only where nothing else is rendering it — the
  // full-page chat, with no record beside it.
  const railOwnsReview = Boolean(run) && !recordOnPage;
  // The rule lives here rather than in every caller: collapsed, unless a
  // DECISION is waiting on this record — then the rail opens, because the
  // decision is inside it.
  const startCollapsed = defaultCollapsed ?? !run;
  // A fresh database ships the virtual `__search__` entry and nothing else;
  // the conversation says so rather than sending a turn that cannot land.
  const workspaceHasAgents = hasWorkspaceAgents(agents);
  // Starts as the page says (open on a record, collapsed elsewhere) until the
  // person collapses or opens one; that choice persists per browser (and per
  // user, server-side) and applies on every page (058, §9).
  const [collapsed, setCollapsed] = useState(startCollapsed);
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
  // A card's decision becomes a typed user turn in THIS conversation (backlog 025).
  const recordCardDecision = useCallback((d: { cardId: string; label: string; action: 'approve' | 'reject' | 'defer' | 'undo'; runId?: number }) => {
    if (session.conversationId === null) {
      return;
    }
    void client.conversations.recordCardDecision({ id: session.conversationId, ...d }).catch((err: unknown) => {
      console.warn('card decision was not written to the conversation', err);
    });
  }, [session.conversationId]);
  const queueProps = useComposerQueueProps(session);
  const onCommand = useChatCommands(session.handleNewChat);
  // The rail IS on a page, so `(+)` offers `@page` and the record in view
  // beside `@artifact` — the same list `@` resolves against. `@change` joins
  // it only where a sequence draft is in view, which is exactly where the
  // intent can be carried out.
  const sequenceInView = Boolean(run) && (run?.card.content ?? []).some(c => c.kind === 'email');
  const tagProps = useComposerTags(agents, effectiveContext, { change: sequenceInView });
  // Latest session for the request listener (registered once, on mount).
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  });
  const asideRef = useRef<HTMLElement | null>(null);
  const narrow = useNarrowViewport();
  // `document` exists only on the client; the rail paints nothing on the
  // server, which is already true of everything it depends on (localStorage,
  // the viewport width).
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect
    setPortalReady(true);
  }, []);
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
      // ⌘⇧O / `/new` / the palette: start over in this rail, then open it.
      if (req.newChat) {
        sessionRef.current.handleNewChat();
      }
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
      // Tags the affordance armed (`@change` from the selection control):
      // the same chips the person would get by typing the word (§ Intents).
      for (const tag of req.tags ?? []) {
        sessionRef.current.addContextRef(tag);
      }
      focusAgentComposer(asideRef.current);
    }
    window.addEventListener(AGENT_SURFACE_EVENT, onRequest);
    return () => window.removeEventListener(AGENT_SURFACE_EVENT, onRequest);
  }, []);

  // Someone outside asked for the chat pane to open or close
  // (`dockState.openChatPane()` / `closeChatPane()`). Handled here because the
  // chat pane owns its own state; a `persist: false` request changes it
  // without teaching this browser a preference nobody expressed.
  useEffect(() => {
    function onSet(e: Event) {
      const req = (e as CustomEvent<{ open?: boolean; persist?: boolean }>).detail ?? {};
      const next = !req.open;
      setCollapsed(next);
      if (req.persist === false) {
        return;
      }
      writeCollapsed(next);
      sessionRef.current.persistRail({ railOpen: !next });
    }
    window.addEventListener(RAIL_SET_EVENT, onSet);
    return () => window.removeEventListener(RAIL_SET_EVENT, onSet);
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
    setCollapsed(readCollapsed(startCollapsed));
    const stored = readStoredRailWidth();
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setWidth(clampRailWidth(stored ?? defaultRailWidth(window.innerWidth), window.innerWidth));
  }, [startCollapsed]);

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
    // ONE pattern, a tag to make it act (2026-09-16). `@change` in the
    // composer says this ask must alter the sequence draft: the send goes to
    // `rewriteDraft` against the content the person anchored, and the send it
    // changed is re-presented. Without the tag the same words are a question
    // the agent answers, and the drafts are untouched. The wording heuristic
    // stays as the untagged fallback so nothing a reviewer already types
    // stops working.
    const tagged = hasChangeIntent(session.contextRefs);
    const anchoredField = pendingNotes[pendingNotes.length - 1]?.field ?? null;
    const asked = run && typed
      ? await guided.askAbout(typed, tagged ? { contentId: contentIdForAsk(anchoredField, typed, guided.sends, guided.state) } : undefined)
      : null;
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
    if (railOwnsReview && typed && isRecallAsk(typed)) {
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

  const showCards = run && railOwnsReview && (!guided.state.decided || guided.outcome);
  // Beside a record page the rail carries a POINTER instead: one line naming
  // what is under discussion, pinned to the top of the transcript where an
  // opening remark belongs, never travelling with the recall anchor — it is
  // not a thing to walk back to, it is how the conversation opens.
  const showPointer = run && recordOnPage;
  const cardBlocks = showCards
    ? [{
        key: 'guided',
        afterIndex: Math.min(cardAnchor, Math.max(lastMessageIndex, -1)),
        // NO wrapper: the rail is already the surface. A bordered box here
        // put the panel's own blocks inside a second frame — the "cards in
        // cards" the Never rule exists to stop (docs/design/patterns.md).
        node: <GuidedReviewPanel run={run} guided={guided} pendingComments={comments?.open.length ?? 0} />,
      }]
    : showPointer
      ? [{ key: 'pointer', afterIndex: -1, node: <SequencePointer run={run} guided={guided} /> }]
      : [];

  // The approval gate joins the transcript blocks instead of sitting above the
  // composer (Chris, 2026-09-24: "show inline instead of sticky to the compose
  // bar"). It goes last so a guided card and a gate raised in the same turn
  // read in the order they happened.
  const blocks = session.pendingHitl
    ? [...cardBlocks, {
        key: 'hitl-gate',
        afterIndex: session.messages.length,
        node: (
          <HitlGate
            gate={session.pendingHitl}
            onApprove={session.handleApproveHitl}
            onReject={session.handleRejectHitl}
            disabled={session.isStreaming}
          />
        ),
      }]
    : cardBlocks;

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
      {/* ONE hairline-separated row, 48px tall: "Chat" with the bubble as the
          title, then 32px ghost controls — New chat, the conversations
          dropdown (All conversations is its last row), collapse; the ⋯ menu
          only in the phone sheet. The autonomy rung moved into the input bar
          beside the model control on 2026-09-18. */}
      {/* In the sheet the close control is absolutely positioned in this
          corner, so the row keeps clear of it rather than stacking under it. */}
      <div className={`flex h-12 shrink-0 items-center gap-1 border-b border-border pl-3 ${narrow ? 'pr-11' : 'pr-1.5'}`}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/* Unscoped, the rail is titled "Chat" with the bubble — not the workspace's name, which the sidebar already says (Chris, 2026-09-18). */}
          {!scopeRef && <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
          <span className="truncate text-sm font-semibold">{scopeRef ? headerName : t('rail_title')}</span>
          {/* The drawer's scope, when an affordance opened it with one
              (`docs/specs/personalization-v2.md`): one line naming the
              subject, so an ask has an unambiguous referent. Not a panel and
              not a second conversation — the same rail, said out loud. */}
          {intent?.scope && (
            <span className="truncate rounded-full bg-surface-soft px-2 py-0.5 text-[11px] text-muted-foreground" data-testid="rail-scope">
              {intent.scope.label}
            </span>
          )}
          {/* Scoped: the workspace agent is who answers about this record.
              Unscoped the header already IS the workspace — no agent name
              ever appears here (§9.10). */}
          {scopeRef && workspaceKnown && !compact && (
            <span className="truncate text-xs text-muted-foreground">{session.workspaceName}</span>
          )}
        </div>
        {/* New chat + conversations as icons; the ⋯ menu in the phone sheet.
            The rung moved into the input bar beside the model control. */}
        <ChatHeaderActions
          onNewChat={session.handleNewChat}
          onCopy={session.messages.length > 0 ? () => transcriptOf(session.messages, session.workspaceName) : null}
          history={scopeRef
            ? null
            : {
                recent: session.recentChats,
                currentId: session.conversationId,
                onPick: id => void session.handlePickConversation(id),
                search: session.searchConversations,
              }}
          compact={narrow}
        />
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
        {session.messages.length === 0 && blocks.length === 0 && !workspaceHasAgents
          ? <NoAgentsState />
          : session.messages.length === 0 && blocks.length === 0
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
                <CardDecisionProvider value={recordCardDecision}>
                  <MessageList
                    messages={session.messages}
                    agentName={session.workspaceName}
                    streaming={session.isStreaming}
                    activity={session.activity}
                    blocks={blocks}
                    onFeedback={session.handleFeedback}
                    autonomy={session.autonomy}
                    conversationId={session.conversationId}
                  />
                </CardDecisionProvider>
              )}

        {/* The cards have scrolled up behind newer turns: one click brings
            them back to the bottom, the same as asking for them (058). */}
        {railOwnsReview && !guided.state.decided && cardsScrolledAway && (
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

        {/* Everything the rail stacks above the box travels as ONE slot, so
            the chips share the composer's column and its left edge rather
            than each carrying its own padding guess (CEO, 2026-09-16). */}
        <ChatComposer
          above={(
            <>
              {comments && (
                <CommentChips
                  comments={comments.open}
                  activeId={comments.activeId}
                  onFocus={comments.focusComment}
                  onRemove={id => void comments.removeComment(id)}
                />
              )}
              {/* "Working with:" — the artifacts this turn will carry, listed
                  because they are ATTACHED, not because the rail is drawing
                  them. Grounding the person can see; the content itself
                  travels server-side (`services/chat/grounding.ts`), and #378
                  still forbids the rail re-rendering what the page shows. */}
              {(effectiveContext?.artifacts?.length ?? 0) > 0 && (
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="dock-working-with">
                  <span className="shrink-0">{t('working_with')}</span>
                  {effectiveContext!.artifacts!.map(a => (
                    <span key={`${a.type}:${a.id}`} className="inline-flex max-w-full items-center rounded-full bg-surface-soft px-2 py-0.5">
                      <span className="truncate text-foreground/85">{a.label ?? `artifact ${a.id}`}</span>
                    </span>
                  ))}
                </div>
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
            </>
          )}
          value={session.composerValue}
          onChange={session.setComposerValue}
          onSubmit={() => void sendWithComments()}
          // Streaming no longer disables anything — Enter queues instead.
          // Boot still does: a message sent before the thread resolves would
          // be discarded when the restored transcript lands.
          disabled={!session.booted}
          streaming={session.isStreaming}
          {...queueProps}
          {...tagProps}
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
          attachments={session.attachments}
          uploading={session.uploading > 0}
          attachError={session.attachError}
          onDismissAttachError={session.clearAttachError}
          onAttachFiles={files => void session.attachFiles(files)}
          onRemoveAttachment={session.removeAttachment}
          onCommand={onCommand}
          controls={<ModelControl value={session.modelPrefs} onChange={session.setModelPrefs} />}
          settings={[autonomyMenuSetting(session.autonomy, autonomyCopy, t('autonomy_thread'))]}
          onSetting={(id, opt) => {
            const rung = id === AUTONOMY_SETTING_ID ? autonomyFromOption(opt) : null;
            if (rung) {
              session.setAutonomy(rung);
            }
          }}
        />
      </div>
    </>
  );

  const ariaLabel = scopeRef ? t('rail_label_about', { scope: scopeLabel }) : t('rail_label');

  // The rail is an OVERLAY, and it is portalled to the document (2026-09-16).
  //
  // Two problems, one fix. (a) The page is full width: a record page never
  // gives a third of itself away to a panel, so the document does not reflow
  // when the rail opens — which also means an anchored highlight and the
  // selection control above it stay exactly where the person put them, the
  // pattern the rail exists to serve. (b) The lead page mounts its OWN dock
  // from inside the shell's page gutter, whose `@container` makes it the
  // containing block for anything `fixed` inside it — so the rail's geometry
  // was measured from the padded, 1180px-capped column instead of the
  // viewport. That is the scroll bug: the rail's bottom, and with it the
  // composer, sat the gutter's top padding BELOW the fold until the page was
  // scrolled. Rendering into `document.body` puts every rail in the same
  // frame no matter which page mounted it.
  if (!portalReady) {
    return null;
  }

  // The edge tab is a POINTER affordance, and it exists only where there is
  // room for it. On a phone it sat over the page's right edge at the vertical
  // centre — across a table's last column, a row's cost, the thing the reader
  // was trying to read — and it was a second door to a room the titlebar
  // already opens: `AgentSurfaceButton` is in the header on every page
  // (principle 6, two surfaces doing one job is a defect). So below the
  // breakpoint the rail collapses to nothing and the header keeps the entry
  // point, which is also what makes the sheet feel like a mobile surface
  // rather than a desktop rail squeezed onto a phone.
  const edgeTab = narrow
    ? null
    : (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setCollapsedPersisted(false)}
              aria-label={t('open_rail')}
              data-testid="rail-edge-tab"
              className="fixed top-1/2 right-0 z-40 flex -translate-y-1/2 flex-col items-center gap-2 rounded-l-xl border border-r-0 border-border bg-background px-1.5 py-3 text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
            >
              <MessageSquare className="size-4" aria-hidden="true" />
              <span className="text-[10px] font-medium tracking-wide [writing-mode:vertical-rl]">Chat</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">{t('open_rail')}</TooltipContent>
        </Tooltip>
      );

  // The resize handle on the column's left edge (§9): drag, or arrow keys
  // when focused. One width for the column, never one per pane.
  const resizeHandle = (
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
  );

  // The chat pane, or null when the person closed it — the column may still
  // be standing with a preview in it.
  const chatPane = collapsed
    ? null
    : (
        <div ref={asideRef as React.RefObject<HTMLDivElement>} className="flex min-h-0 flex-1 flex-col">
          {body}
        </div>
      );

  // Below the breakpoint the column covers the page as a sheet instead of
  // narrowing it (032 §3.2).
  //
  // The sheet comes up from the BOTTOM. It used to slide in from the right
  // and then cover the whole screen anyway, so it paid an animation from the
  // wrong edge for nothing — and it put the composer, the one control a
  // person actually reaches for, as far from the thumb as the screen allows.
  // A bottom sheet is where a phone expects a transient surface to live.
  //
  // It opens tall (88vh) rather than at a peek height. This sheet's job is a
  // conversation, and a conversation with the keyboard up has almost no room
  // left at a peek — the reason to drag it open would be immediate and
  // constant, so it simply opens where a reader would have dragged it.
  const column = (
    <RailColumn
      priority="dock"
      chat={chatPane}
      closed={edgeTab}
      narrow={narrow}
      width={width}
      resizeHandle={resizeHandle}
      aria-label={ariaLabel}
      frame={narrow
        ? content => (
          <Sheet open onOpenChange={open => setCollapsedPersisted(!open)}>
            <SheetContent
              side="bottom"
              className="flex h-[88dvh] w-full min-w-0 flex-col gap-0 overflow-x-clip rounded-t-2xl p-0"
              // The grabber (16px) then a 48px header row puts that row's
              // centre at 40px; the close belongs on it, beside the ⋯ menu,
              // not in the sheet's corner 24px above everything it sits with.
              closeClassName="top-10 right-3 -translate-y-1/2"
              aria-label={ariaLabel}
            >
              {/* The grabber. It is not a control — the sheet is dismissed by
                  its close button or the overlay — but it is what tells a
                  reader at a glance which edge this surface belongs to. */}
              <div aria-hidden className="mx-auto mt-2 mb-1 h-1 w-9 shrink-0 rounded-full bg-border" />
              <SheetHeader className="sr-only">
                <SheetTitle>{ariaLabel}</SheetTitle>
                {/* One identity (§9.10): the sheet is described as the workspace, never an agent. */}
                <SheetDescription>{headerName}</SheetDescription>
              </SheetHeader>
              {content}
            </SheetContent>
          </Sheet>
        )
        : undefined}
    />
  );

  return narrow ? column : createPortal(column, document.body);
}
