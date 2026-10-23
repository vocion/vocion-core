'use client';

import type { DecisionAnswer, DecisionView } from '@/libs/decisions/decision';
import type { DoneReceipt } from '@/libs/decisions/receipt';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AgentDot } from '@/components/ui/agent-dot';
import { ConnectSystemsFlow } from '@/features/dashboard/connect-systems/ConnectSystemsFlow';
import { startConnectSystems, useConnectSystems } from '@/features/dashboard/connect-systems/launch';
import { forgetWalk, recallWalk, rememberWalk } from '@/features/dashboard/connect-systems/walkMemory';
import { useLive } from '@/hooks/useLive';
import { connectSystemsInputOfHref } from '@/libs/connect/systemsLink';
import { decisionKey } from '@/libs/decisions/decision';
import { isConnectStart, listenForConnectReturn, openConnectTab } from '../connectTabHandoff';
import { dockPlan } from '../emptyChat';
import { stepForConnector } from '../useAnswerOnConnectReturn';
import { WaitingNudge } from '../WaitingNudge';
import { DecisionCard } from './DecisionCard';
import { decisionTopics, settledElsewhere, settledElsewhereLine } from './dockLive';
import { DoneReceipts } from './DoneReceipts';

/**
 * The Decisions waiting on the person, docked above the composer: ONE card at a
 * time — this conversation's own first, oldest first, then what waits on them
 * elsewhere (a Needs you question, a proposal from no conversation) once the
 * person asked to answer those here — with "1 of 3" when more wait behind it.
 * Nothing docks that the person did not start (`chat/emptyChat.ts` `dockPlan`):
 * what waits elsewhere is the one soft chip, never a card on its own. It blocks only itself: the composer below
 * stays live ("Or reply directly…"), and a typed reply is read against the
 * conversation's own card before it is routed. Nor is it locked while the
 * agent is still replying: an answer given then is held and goes the moment
 * the turn lands (`useChatSession.answerDecision`).
 *
 * Folding it away (Esc, the chevron) answers nothing: it shrinks to one line,
 * "N decisions waiting", and opens again from there. It folds by itself once
 * the person has sent a message and the reply starts to stream in (Chris,
 * 2026-10-23: "shouldn't automatically collapse when I click in the compose
 * bar, but it can or should collapse when I submit, and start getting new
 * text"). Tapping into or typing in the composer folds nothing. An answer given to one
 * that waits elsewhere starts no turn; the dock says once what it did.
 * @param props - The dock.
 * @param props.decisions - This conversation's open Decisions, oldest first; the dock shows the newest first.
 * @param props.waiting - What waits on the person elsewhere.
 * @param props.onAnswer - Sends the answer: to the agent that asked, or where it lives.
 * @param props.onOpen - Opens an option's flow.
 * @param props.agentName - The asking agent's name, by slug.
 * @param props.agentAccent
 * @param props.answeringId - The Decision whose answer is on its way.
 * @param props.disabled - Nothing may be answered now.
 * @param props.updating - What the running turn may revise: those cards read "Updating…" and wait.
 * @param props.replying - The running turn's answer has started to stream in.
 * @param props.error - Why the last answer did not land.
 * @param props.notice - What the last answer from the queue did.
 * @param props.onDismissNotice - Clears it.
 */
export function DecisionDock({ decisions, waiting = [], onAnswer, onOpen, agentName, agentAccent, answeringId = null, disabled = false, updating, replying = false, error = null, notice = null, onDismissNotice }: {
  decisions: DecisionView[];
  waiting?: DecisionView[];
  onAnswer: (decision: DecisionView, answer: DecisionAnswer) => void;
  /** Opens an option's flow (a sign-in, the connect walk); the page navigates by default. */
  onOpen?: (href: string, decision: DecisionView) => void;
  agentName?: (slug: string | null) => string | null;
  /** The asking agent's accent, for its avatar on the card. */
  agentAccent?: (slug: string | null) => string | null;
  answeringId?: number | null;
  disabled?: boolean;
  /** The Decisions a running turn may revise (they waited when the person replied), by `decisionKey`. */
  updating?: ReadonlySet<string>;
  /** The running turn's answer has started to stream in. */
  replying?: boolean;
  error?: string | null;
  notice?: { line: string; receipt?: DoneReceipt } | null;
  onDismissNotice?: () => void;
}) {
  const here = new Set(decisions.map(decisionKey));
  // THE NEWEST OF THIS CONVERSATION'S OWN FIRST (2026-10-23: a revised draft
  // queued behind the one it revised, so the card never seemed to change).
  // Every one stays reachable: "1 of 2", and the folded bar's count. A setup
  // plan is a sequence, so while one is docked its steps keep their order.
  const own = decisions.some(d => d.kind === 'setup') ? decisions : [...decisions].reverse();
  const queue = [...own, ...waiting.filter(d => !here.has(decisionKey(d)))];
  const current = queue[0];
  const [collapsedFor, setCollapsedFor] = useState<string | null>(null);
  const currentKey = current ? decisionKey(current) : null;
  // The person replied in chat and the answer is arriving: the card it may
  // revise steps aside, once per turn. Their own hand opens it again.
  const replyingTo = replying && currentKey !== null && (updating?.has(currentKey) ?? false) ? currentKey : null;
  const [foldedForReply, setFoldedForReply] = useState<string | null>(null);
  if (replyingTo !== foldedForReply) {
    setFoldedForReply(replyingTo);
    if (replyingTo !== null) {
      setCollapsedFor(replyingTo);
    }
  }
  // SEVERAL ASKS ARE ONE ROW (a phone walk, 2026-10-10: eight approvals
  // stacked up in one goal). "8 asks · Review" until the person opens them;
  // then one card at a time, "1 of 8", as before.
  const [reviewing, setReviewing] = useState(false);
  if (!current && !notice) {
    return null;
  }
  const compact = current !== undefined && queue.length > 1 && !reviewing && answeringId === null;
  return (
    <div data-testid="decision-dock">
      {notice && (
        <div className="mb-2 flex items-start gap-2 px-1 text-[12.5px] text-muted-foreground" data-testid="decision-notice" role="status">
          <div className="min-w-0 flex-1">
            <p className="truncate">{notice.line}</p>
            {notice.receipt && <DoneReceipts receipts={[notice.receipt]} />}
          </div>
          {onDismissNotice && (
            <button type="button" onClick={onDismissNotice} aria-label="Dismiss" className="grid shrink-0 place-items-center rounded p-0.5 hover:bg-surface-hover hover:text-foreground max-md:size-11">
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      )}
      {current && compact && (
        <button
          type="button"
          onClick={() => setReviewing(true)}
          data-testid="decision-asks-row"
          className="mb-2 flex w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-[13px] shadow-sm transition hover:bg-surface-hover max-md:min-h-11"
        >
          {agentName?.(current.agentSlug) && <AgentDot name={agentName(current.agentSlug)!} accent={agentAccent?.(current.agentSlug) ?? null} size="sm" decorative />}
          <span className="shrink-0 font-medium text-foreground">{asksLine(queue.length)}</span>
          <span className="min-w-0 truncate text-muted-foreground">{agentName?.(current.agentSlug) ?? ''}</span>
          <span className="ml-auto shrink-0 font-medium text-foreground">Review</span>
        </button>
      )}
      {current && !compact && (
        <DecisionCard
          decision={current}
          agentName={agentName?.(current.agentSlug) ?? null}
          agentAccent={agentAccent?.(current.agentSlug) ?? null}
          context={here.has(decisionKey(current)) ? null : 'Waiting on you'}
          position={{ index: 0, total: queue.length }}
          collapsed={collapsedFor === decisionKey(current)}
          onCollapsedChange={folded => setCollapsedFor(folded ? decisionKey(current) : null)}
          onAnswer={answer => onAnswer(current, answer)}
          {...(onOpen ? { onOpen: (href: string) => onOpen(href, current) } : {})}
          busy={answeringId === current.id}
          disabled={disabled}
          updating={(updating?.has(decisionKey(current)) ?? false) && answeringId !== current.id}
          error={error}
        />
      )}
    </div>
  );
}

/**
 * The one row several open asks fold into: "3 asks · Review" reads as the
 * count, and the row's own button says Review.
 * @param count - How many wait.
 */
export function asksLine(count: number): string {
  return `${count} ${count === 1 ? 'ask' : 'asks'} ·`;
}

/** The parts of a chat session the dock reads. */
type DockSession = {
  openDecisions: DecisionView[];
  waitingDecisions: DecisionView[];
  dockNotice: { line: string; receipt?: DoneReceipt } | null;
  dismissDockNotice: () => void;
  answerDecision: (decision: DecisionView, answer: DecisionAnswer) => void;
  answeringDecisionId: number | null;
  decisionError: string | null;
  agentNameOf: (slug: string | null) => string | null;
  agentAccentOf?: (slug: string | null) => string | null;
  conversationId: number | null;
  /** Reads the open Decisions again; the dock calls it when one changes on the live stream. */
  refreshDecisions?: () => void;
  sendMessage: (text: string) => unknown;
  messages: readonly unknown[];
  isStreaming?: boolean;
  /** The running turn's answer has started to stream in. */
  isAnswering?: boolean;
};

/**
 * The dock, wired to a chat session — what every surface with a composer
 * (the full chat page, the rail, a conversation's artifact view) puts first
 * in the composer's `above` slot.
 * @param props - The session.
 * @param props.session - The chat session (`useChatSession`).
 */
export function ConversationDecisions({ session }: { session: DockSession }) {
  // "Connect your systems" is a setup Decision whose option opens the docked
  // walk-through: while the walk runs it IS the docked card — one at a time —
  // and when it finishes it answers the Decision that started it.
  // Started only from a Decision the lead raised in this thread ("Start"),
  // never by the page's address: a link asks the lead first (`openingAsk`).
  const walk = useConnectSystems(null);
  // A walk this conversation was in the middle of, before a reload or a trip
  // through the drawer, picks up where it was while the Decision it answers
  // is still open (`walkMemory.ts`); once that Decision is answered, it is over.
  const conversationId = session.conversationId;
  const openIds = session.openDecisions.map(d => d.id).join(',');
  const walking = walk.active !== null;
  useEffect(() => {
    if (walking || conversationId === null || !openIds) {
      return;
    }
    const was = recallWalk(conversationId);
    if (!was) {
      return;
    }
    if (was.decisionId !== undefined && openIds.split(',').includes(String(was.decisionId))) {
      startConnectSystems({ input: was.input, decisionId: was.decisionId, resume: { picked: was.picked, outcomes: was.outcomes } });
    } else {
      forgetWalk(conversationId);
    }
  }, [walking, conversationId, openIds]);
  // A sign-in opened in its own tab: the card waits here, and the step is
  // answered here when that tab hands the outcome back (`connectTabHandoff.ts`).
  const [waitingTab, setWaitingTab] = useState(false);
  const [tabNotice, setTabNotice] = useState<string | null>(null);
  // What was answered on this page, so the dock never calls its own answer "settled elsewhere".
  const answeredHere = useRef(new Set<string>());
  const decisionsRef = useRef(session.openDecisions);
  const answerRef = useRef(session.answerDecision);
  useEffect(() => {
    decisionsRef.current = session.openDecisions;
    answerRef.current = session.answerDecision;
  });
  useEffect(() => listenForConnectReturn((outcome) => {
    const step = stepForConnector(decisionsRef.current, outcome.connector);
    if (!step) {
      return false;
    }
    setWaitingTab(false);
    if (outcome.ok) {
      setTabNotice(null);
      answeredHere.current.add(decisionKey(step.view));
      answerRef.current(step.view, { kind: 'option', optionIds: [step.optionId] });
    } else {
      setTabNotice(`That didn't connect (${outcome.reason ?? 'no reason given'}). Try again from the card.`);
    }
    return true;
  }), []);
  // Nothing docks that the person did not start (`dockPlan`): this
  // conversation's own once it is under way; what waits elsewhere only after
  // they tap its chip — never by itself, mid-flow, beside the lead's own ask.
  const plan = dockPlan({
    own: session.openDecisions,
    elsewhere: session.waitingDecisions,
    messageCount: session.messages.length,
    personStarted: false,
    // Never docked by a tap: what waits elsewhere is answered where it lives
    // (Review, a page) — no chip in chat opens a card without a turn.
    elsewhereOpened: false,
    streaming: session.isStreaming ?? false,
  });
  // LIVE: a docked Decision settled anywhere else — Review, another tab,
  // Slack, a teammate, the agent withdrawing it — leaves the dock now, and
  // the dock says so once (`dockLive.ts`). Its own answers it says nothing
  // about: those are already in the thread.
  const shown = [...plan.own, ...plan.elsewhere];
  const liveAsked = useRef(false);
  const lastShown = useRef(shown);
  const [elsewhereLine, setElsewhereLine] = useState<string | null>(null);
  const refreshDecisions = session.refreshDecisions;
  useLive(decisionTopics(shown), () => {
    liveAsked.current = true;
    refreshDecisions?.();
  });
  // Back to the tab: what changed while it was hidden, read once.
  useEffect(() => {
    if (!refreshDecisions) {
      return;
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        liveAsked.current = true;
        refreshDecisions();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshDecisions]);
  const shownKey = shown.map(decisionKey).join(',');
  useEffect(() => {
    const before = lastShown.current;
    lastShown.current = shown;
    if (!liveAsked.current) {
      return;
    }
    liveAsked.current = false;
    const gone = settledElsewhere(before, shown, answeredHere.current);
    if (gone.length > 0) {
      setElsewhereLine(settledElsewhereLine(gone));
    }
  }, [shownKey]);
  useEffect(() => {
    if (!elsewhereLine) {
      return;
    }
    const timer = setTimeout(() => setElsewhereLine(null), 6000);
    return () => clearTimeout(timer);
  }, [elsewhereLine]);
  // A TURN THAT MAY REVISE THE CARD (Chris, 2026-10-23: "chat said it updated
  // the recommendation based on my input, but I didn't see streaming/waiting
  // animation and update on the card"). What was docked when the turn began
  // reads "Updating…" until it lands; a card the turn itself raises does not.
  const streaming = session.isStreaming ?? false;
  const ownKey = plan.own.map(decisionKey).join(',');
  const [turn, setTurn] = useState<{ streaming: boolean; keys: ReadonlySet<string> }>(() => ({ streaming, keys: new Set() }));
  if (turn.streaming !== streaming) {
    setTurn({ streaming, keys: streaming && ownKey ? new Set(ownKey.split(',')) : new Set() });
  }
  const updatingKeys = turn.keys;
  const answer = (decision: DecisionView, a: DecisionAnswer) => {
    answeredHere.current.add(decisionKey(decision));
    session.answerDecision(decision, a);
  };

  if (walk.active) {
    const active = walk.active;
    return (
      <ConnectSystemsFlow
        key={active.key}
        input={active.input}
        resume={active.resume ?? null}
        intro={active.intro ?? null}
        onProgress={where => rememberWalk(conversationId, { input: active.input, ...(active.decisionId !== undefined ? { decisionId: active.decisionId } : {}), ...where })}
        decision={active.decisionId !== undefined && conversationId !== null ? { conversationId, decisionId: active.decisionId } : null}
        onClose={() => {
          forgetWalk(conversationId);
          walk.close();
        }}
        onSomethingElse={text => void session.sendMessage(text)}
      />
    );
  }
  if (plan.nudge !== null && !session.dockNotice) {
    return (
      <div className="mb-2 flex justify-center" data-testid="decision-dock-nudge">
        <WaitingNudge count={plan.nudge} />
      </div>
    );
  }
  return (
    <DecisionDock
      decisions={plan.own}
      waiting={plan.elsewhere}
      notice={waitingTab ? { line: 'Finish signing in in the new tab. This card updates when you are done.' } : tabNotice ? { line: tabNotice } : session.dockNotice ?? (elsewhereLine ? { line: elsewhereLine } : null)}
      onDismissNotice={() => {
        if (waitingTab || tabNotice) {
          setWaitingTab(false);
          setTabNotice(null);
        } else if (!session.dockNotice && elsewhereLine) {
          setElsewhereLine(null);
        } else {
          session.dismissDockNotice();
        }
      }}
      onAnswer={answer}
      onOpen={(href, decision) => {
        const input = connectSystemsInputOfHref(href);
        if (input) {
          startConnectSystems({ input, decisionId: decision.id });
        } else if (isConnectStart(href) && openConnectTab(href)) {
          setWaitingTab(true);
        } else {
          window.location.assign(href);
        }
      }}
      agentName={session.agentNameOf}
      agentAccent={session.agentAccentOf}
      answeringId={session.answeringDecisionId}
      updating={updatingKeys}
      replying={session.isAnswering ?? false}
      error={session.decisionError}
    />
  );
}

/**
 * The Decision as the latest item IN the conversation, not a capped box above
 * the composer (founder, 2026-10-09: "the card was unreadable because the
 * inner scroll content window was so tiny"). Full height, every option and
 * its consequence visible; the thread scrolls naturally and the card with it,
 * into view when it arrives, the composer below it. Still one at a time.
 * @param session - The chat session.
 * @returns The block `MessageList` draws after the last message.
 */
export function decisionBlock(session: DockSession): { key: string; afterIndex: number; node: React.ReactNode } {
  return { key: 'conversation-decisions', afterIndex: Number.MAX_SAFE_INTEGER, node: <ConversationDecisions session={session} /> };
}
