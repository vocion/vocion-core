'use client';

import { createContext, use } from 'react';

/**
 * How a card tells the conversation what the person decided (backlog 025).
 *
 * Provided once by the surface that knows the conversation (ChatDock,
 * ChatShell); a card anywhere under it records its decision ON THE CARD
 * through `conversations.recordCardDecision` — the action, who, when, and
 * which typed option — never as a turn the person did not type. A card
 * rendered somewhere with no conversation (a preview, a test) finds no
 * provider and records nothing — the decision itself still went through the
 * action registry.
 */
export type CardDecision = {
  cardId: string;
  label: string;
  action: 'approve' | 'reject' | 'defer' | 'undo';
  runId?: number;
  /** The typed option chosen, on a card that offers several (A/B/C/D). */
  optionId?: string;
  /** Kept for callers that still send it: no card decision writes a turn for the person anymore. */
  turn?: boolean;
};

const CardDecisionContext = createContext<((d: CardDecision) => void) | null>(null);

export const CardDecisionProvider = CardDecisionContext.Provider;

/** The recorder, or a no-op where no conversation is around the card. */
export function useRecordCardDecision(): (d: CardDecision) => void {
  return use(CardDecisionContext) ?? (() => {});
}
