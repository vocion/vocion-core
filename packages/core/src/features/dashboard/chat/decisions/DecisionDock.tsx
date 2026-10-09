'use client';

import type { DecisionAnswer, DecisionView } from '@/libs/decisions/decision';
import { useState } from 'react';
import { DecisionCard } from './DecisionCard';

/**
 * The open Decisions of one conversation, docked above its composer: ONE card
 * at a time, the oldest first, with "1 of 3" when more wait behind it. It
 * blocks only itself — the composer below stays live ("Or reply directly…"),
 * and a typed reply is read against this card before it is routed.
 *
 * Folding it away (Esc, the chevron) answers nothing: it shrinks to one line,
 * "1 decision waiting", and opens again from there. A new Decision arriving
 * unfolds it.
 * @param props - The dock.
 * @param props.decisions - The open Decisions, oldest first.
 * @param props.onAnswer - Sends the answer to the agent that asked.
 * @param props.agentName - The asking agent's name, by slug.
 * @param props.answeringId - The Decision whose answer is on its way.
 * @param props.disabled - Nothing may be answered now (a turn is running).
 * @param props.error - Why the last answer did not land.
 */
export function DecisionDock({ decisions, onAnswer, agentName, answeringId = null, disabled = false, error = null }: {
  decisions: DecisionView[];
  onAnswer: (decision: DecisionView, answer: DecisionAnswer) => void;
  agentName?: (slug: string | null) => string | null;
  answeringId?: number | null;
  disabled?: boolean;
  error?: string | null;
}) {
  const current = decisions[0];
  const [collapsedFor, setCollapsedFor] = useState<number | null>(null);
  if (!current) {
    return null;
  }
  return (
    <div data-testid="decision-dock">
      <DecisionCard
        decision={current}
        agentName={agentName?.(current.agentSlug) ?? null}
        position={{ index: 0, total: decisions.length }}
        collapsed={collapsedFor === current.id}
        onCollapsedChange={folded => setCollapsedFor(folded ? current.id : null)}
        onAnswer={answer => onAnswer(current, answer)}
        busy={answeringId === current.id}
        disabled={disabled}
        error={error}
      />
    </div>
  );
}

/** The parts of a chat session the dock reads. */
type DockSession = {
  openDecisions: DecisionView[];
  answerDecision: (decision: DecisionView, answer: DecisionAnswer) => void;
  answeringDecisionId: number | null;
  decisionError: string | null;
  isStreaming: boolean;
  agentNameOf: (slug: string | null) => string | null;
};

/**
 * The dock, wired to a chat session — what every surface with a composer
 * (the full chat page, the rail, a conversation's artifact view) puts first
 * in the composer's `above` slot.
 * @param props - The session.
 * @param props.session - The chat session (`useChatSession`).
 */
export function ConversationDecisions({ session }: { session: DockSession }) {
  return (
    <DecisionDock
      decisions={session.openDecisions}
      onAnswer={session.answerDecision}
      agentName={session.agentNameOf}
      answeringId={session.answeringDecisionId}
      disabled={session.isStreaming}
      error={session.decisionError}
    />
  );
}
