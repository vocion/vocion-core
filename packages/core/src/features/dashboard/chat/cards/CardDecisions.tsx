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
export type CardDecision = { cardId: string; label: string; action: 'approve' | 'reject' | 'defer' | 'undo'; runId?: number };

const CardDecisionContext = createContext<((d: CardDecision) => void) | null>(null);

export const CardDecisionProvider = CardDecisionContext.Provider;

/** The recorder, or a no-op where no conversation is around the card. */
export function useRecordCardDecision(): (d: CardDecision) => void {
  return use(CardDecisionContext) ?? (() => {});
}
