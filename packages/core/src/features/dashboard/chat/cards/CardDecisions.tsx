'use client';

import { createContext, use } from 'react';

/**
 * How a card tells the conversation what the person decided (backlog 025).
 *
 * Provided once by the surface that knows the conversation (ChatDock,
 * ChatShell); a card anywhere under it records its decision as a typed user
 * turn through `conversations.recordCardDecision`. A card rendered somewhere
 * with no conversation (a preview, a test) finds no provider and records
 * nothing — the decision itself still went through the action registry.
 */
export type CardDecision = { cardId: string; label: string; action: 'approve' | 'reject' | 'defer' | 'undo' | 'dismiss'; runId?: number };

const CardDecisionContext = createContext<((d: CardDecision) => Promise<boolean> | void) | null>(null);

export const CardDecisionProvider = CardDecisionContext.Provider;

/** The recorder, or a no-op where no conversation is around the card. A recorder that answers `false` could not write the decision. */
export function useRecordCardDecision(): (d: CardDecision) => Promise<boolean> | void {
  return use(CardDecisionContext) ?? (() => {});
}

/**
 * How a choice card sends its answer (#1028). Provided beside
 * `CardDecisionProvider`: the answer is a chat turn carrying `card_answer`, so
 * it needs the live session that owns the send path. Found nowhere (a preview,
 * a test) there is nothing to send with, and the card is read-only.
 */
export type CardAnswerInput = { cardId: string; optionId: 'A' | 'B' | 'C' | 'D' | 'other'; text: string };

export type CardAnswerSender = {
  answer: (a: CardAnswerInput) => void;
  /** True while a reply is streaming or a file is uploading: the session cannot take an answer now. */
  busy: boolean;
};

const CardAnswerContext = createContext<CardAnswerSender | null>(null);

export const CardAnswerProvider = CardAnswerContext.Provider;

/** The answer sender, or null where no conversation is around the card (the card is then read-only). */
export function useAnswerCard(): CardAnswerSender | null {
  return use(CardAnswerContext);
}
