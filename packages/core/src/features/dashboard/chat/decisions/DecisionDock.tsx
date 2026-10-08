'use client';

import type { ConnectPlanInput } from '@/libs/connect/systemsPlan';
import type { DecisionAnswer, DecisionView } from '@/libs/decisions/decision';
import type { DoneReceipt } from '@/libs/decisions/receipt';
import { X } from 'lucide-react';
import { useState } from 'react';
import { ConnectSystemsFlow } from '@/features/dashboard/connect-systems/ConnectSystemsFlow';
import { startConnectSystems, useConnectSystems } from '@/features/dashboard/connect-systems/launch';
import { connectSystemsInputOfHref } from '@/libs/connect/systemsLink';
import { decisionKey } from '@/libs/decisions/decision';
import { DecisionCard } from './DecisionCard';
import { DoneReceipts } from './DoneReceipts';

/**
 * The Decisions waiting on the person, docked above the composer: ONE card at a
 * time — this conversation's own first, oldest first, then what waits on them
 * elsewhere (a Needs you question, a proposal from no conversation) — with
 * "1 of 3" when more wait behind it. It blocks only itself: the composer below
 * stays live ("Or reply directly…"), and a typed reply is read against the
 * conversation's own card before it is routed. Nor is it locked while the
 * agent is still replying: an answer given then is held and goes the moment
 * the turn lands (`useChatSession.answerDecision`).
 *
 * Folding it away (Esc, the chevron) answers nothing: it shrinks to one line,
 * "N decisions waiting", and opens again from there. An answer given to one
 * that waits elsewhere starts no turn; the dock says once what it did.
 * @param props - The dock.
 * @param props.decisions - This conversation's open Decisions, oldest first.
 * @param props.waiting - What waits on the person elsewhere.
 * @param props.onAnswer - Sends the answer: to the agent that asked, or where it lives.
 * @param props.onOpen - Opens an option's flow.
 * @param props.agentName - The asking agent's name, by slug.
 * @param props.answeringId - The Decision whose answer is on its way.
 * @param props.disabled - Nothing may be answered now.
 * @param props.error - Why the last answer did not land.
 * @param props.notice - What the last answer from the queue did.
 * @param props.onDismissNotice - Clears it.
 */
export function DecisionDock({ decisions, waiting = [], onAnswer, onOpen, agentName, answeringId = null, disabled = false, error = null, notice = null, onDismissNotice }: {
  decisions: DecisionView[];
  waiting?: DecisionView[];
  onAnswer: (decision: DecisionView, answer: DecisionAnswer) => void;
  /** Opens an option's flow (a sign-in, the connect walk); the page navigates by default. */
  onOpen?: (href: string, decision: DecisionView) => void;
  agentName?: (slug: string | null) => string | null;
  answeringId?: number | null;
  disabled?: boolean;
  error?: string | null;
  notice?: { line: string; receipt?: DoneReceipt } | null;
  onDismissNotice?: () => void;
}) {
  const here = new Set(decisions.map(decisionKey));
  const queue = [...decisions, ...waiting.filter(d => !here.has(decisionKey(d)))];
  const current = queue[0];
  const [collapsedFor, setCollapsedFor] = useState<string | null>(null);
  if (!current && !notice) {
    return null;
  }
  return (
    <div data-testid="decision-dock">
      {notice && (
        <div className="mb-2 flex items-start gap-2 px-1 text-[12.5px] text-muted-foreground" data-testid="decision-notice" role="status">
          <div className="min-w-0 flex-1">
            <p className="truncate">{notice.line}</p>
            {notice.receipt && <DoneReceipts receipts={[notice.receipt]} />}
          </div>
          {onDismissNotice && (
            <button type="button" onClick={onDismissNotice} aria-label="Dismiss" className="shrink-0 rounded p-0.5 hover:bg-surface-hover hover:text-foreground">
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      )}
      {current && (
        <DecisionCard
          decision={current}
          agentName={agentName?.(current.agentSlug) ?? null}
          context={here.has(decisionKey(current)) ? null : 'Waiting on you'}
          position={{ index: 0, total: queue.length }}
          collapsed={collapsedFor === decisionKey(current)}
          onCollapsedChange={folded => setCollapsedFor(folded ? decisionKey(current) : null)}
          onAnswer={answer => onAnswer(current, answer)}
          {...(onOpen ? { onOpen: (href: string) => onOpen(href, current) } : {})}
          busy={answeringId === current.id}
          disabled={disabled}
          error={error}
        />
      )}
    </div>
  );
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
  conversationId: number | null;
  sendMessage: (text: string) => unknown;
};

/**
 * The dock, wired to a chat session — what every surface with a composer
 * (the full chat page, the rail, a conversation's artifact view) puts first
 * in the composer's `above` slot.
 * @param props - The session.
 * @param props.session - The chat session (`useChatSession`).
 * @param props.connectSystems - A walk the page address named, started at once.
 */
export function ConversationDecisions({ session, connectSystems = null }: { session: DockSession; connectSystems?: ConnectPlanInput | null }) {
  // "Connect your systems" is a setup Decision whose option opens the docked
  // walk-through: while the walk runs it IS the docked card — one at a time —
  // and when it finishes it answers the Decision that started it.
  const walk = useConnectSystems(connectSystems ? { input: connectSystems } : null);
  if (walk.active) {
    return (
      <ConnectSystemsFlow
        key={walk.active.key}
        input={walk.active.input}
        decision={walk.active.decisionId !== undefined && session.conversationId !== null ? { conversationId: session.conversationId, decisionId: walk.active.decisionId } : null}
        onClose={walk.close}
        onSomethingElse={text => void session.sendMessage(text)}
      />
    );
  }
  return (
    <DecisionDock
      decisions={session.openDecisions}
      waiting={session.waitingDecisions}
      notice={session.dockNotice}
      onDismissNotice={session.dismissDockNotice}
      onAnswer={session.answerDecision}
      onOpen={(href, decision) => {
        const input = connectSystemsInputOfHref(href);
        if (input) {
          startConnectSystems({ input, decisionId: decision.id });
        } else {
          window.location.assign(href);
        }
      }}
      agentName={session.agentNameOf}
      answeringId={session.answeringDecisionId}
      error={session.decisionError}
    />
  );
}
