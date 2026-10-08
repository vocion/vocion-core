'use client';

import type { ReactNode } from 'react';
import type { DecisionView } from '@/libs/decisions/decision';
import { DecisionCard } from '@/features/dashboard/chat/decisions/DecisionCard';

/**
 * A STEP OF "CONNECT YOUR SYSTEMS", drawn by the one Decision card
 * (`chat/decisions/DecisionCard.tsx`) — there is no second docked card. The
 * walk is a run of small decisions it holds itself (which systems, connect or
 * later, a key, a setting); this maps a step's props onto the card's, so the
 * walk keeps its keyboard contract because it is the same component:
 * numbers pick, arrows move, Enter submits, Tab reaches "Something else",
 * Esc goes back a step or stops.
 */

export type DockedOption = {
  id: string;
  label: string;
  /** One line: what choosing it does. */
  consequence?: string;
  recommended?: boolean;
};

export type DockedAnswer
  = | { kind: 'option'; optionIds: string[] }
    | { kind: 'free_text'; text: string }
    | { kind: 'skip' };

export type DockedDecisionProps = {
  /** Stable per step: a new id starts fresh on its recommendation. */
  id: string;
  /** The eyebrow, e.g. "Connect your systems". */
  eyebrow: string;
  /** "2 of 5", drawn after the eyebrow. */
  progress?: { index: number; total: number } | null;
  question: string;
  body?: ReactNode;
  options: DockedOption[];
  multiple?: boolean;
  allowOther?: boolean;
  /** The Skip button; null hides it. */
  skipLabel?: string | null;
  submitLabel?: string;
  onAnswer: (answer: DockedAnswer) => void;
  /** Esc, and the labelled × — back a step, or stop the walk. */
  onEscape?: () => void;
  escapeLabel?: string;
  /** What the step needs typed in, above the options. */
  children?: ReactNode;
  busy?: boolean;
  error?: string | null;
  takeFocus?: boolean;
};

export function DockedDecision({ id, eyebrow, progress, question, body, options, multiple = false, allowOther = true, skipLabel = 'Skip', submitLabel = 'Submit', onAnswer, onEscape, escapeLabel = 'Stop', children, busy = false, error = null, takeFocus = true }: DockedDecisionProps) {
  const step: DecisionView = {
    id: 0,
    kind: 'setup',
    question,
    options: options.map(o => ({ id: o.id, label: o.label, ...(o.consequence ? { consequence: o.consequence } : {}), ...(o.recommended ? { recommended: true } : {}) })),
    allowOther,
    multiple,
    state: 'open',
    agentSlug: null,
    ownerUserId: null,
    conversationId: null,
  };
  return (
    <DecisionCard
      decision={step}
      stepKey={id}
      eyebrow={eyebrow}
      {...(progress ? { position: progress } : {})}
      bodyNode={body}
      skipLabel={skipLabel}
      submitLabel={submitLabel}
      onAnswer={onAnswer}
      {...(onEscape ? { onEscape } : {})}
      escapeLabel={escapeLabel}
      busy={busy}
      error={error}
      takeFocus={takeFocus}
    >
      {children}
    </DecisionCard>
  );
}
