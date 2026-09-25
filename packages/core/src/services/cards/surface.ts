/**
 * SURFACING A CARD — the one path from a producer to the person (backlog 025).
 *
 * Order matters and is the whole point: the card is written to the ledger
 * and to the wire FIRST, unfiled, so it exists on screen and on the row
 * whatever happens next; filing it as a proposal (done-for-you) is a second
 * step that reports back as a `card_update`. On 2026-09-25 the reverse order
 * lost cards (finding 18): filing ran first, and when it went quiet the card
 * reached neither place. Now a slow or failing file is a card that says
 * "not filed", never a card that is not there.
 */
import type { Card } from '@/libs/cards/card';
import type { AgentEvent } from '@/services/agents/types';
import type { RunCollector } from '@/services/chat/runCollector';
import { recommendationFromCard } from '@/libs/cards/card';

/** How long a card waits to be filed before it is shown unfiled — a card the person can press beats a filed one they never see. */
export const AUTO_FILE_MS = 8_000;

export type SurfaceDeps = {
  /** Writes an event to the wire (and the resume buffer). */
  write: (event: AgentEvent) => void;
  /** The turn's ledger; absent on a surface with no persisted conversation. */
  collector?: RunCollector | null;
  /** Files the card as a proposal and returns its id, or null when it could not. Absent under ask-before-acting. */
  file?: (card: Card) => Promise<number | null>;
  /** For the log line. */
  where: { conversationId: number | null; agentSlug: string };
};

/**
 * Put a card in front of the person: ledger, wire, then (done-for-you) file
 * it and update. Resolves when the update has been written or given up on.
 * @param card - A checked card.
 * @param deps - Where it goes.
 */
export async function surfaceCard(card: Card, deps: SurfaceDeps): Promise<void> {
  deps.collector?.onCard({ id: card.id, kind: card.kind, label: card.title, actionId: card.actions[0]?.actionId ?? '', input: card.actions[0]?.input, runId: card.runId, state: card.state });
  deps.write({ type: 'card', card });
  // One line per card lifecycle (backlog 025 § testable): a card that never
  // shows up in the log never showed up at all — that is how finding 18 was
  // established a day late.
  console.warn('card: surfaced', { ...deps.where, cardId: card.id, kind: card.kind, title: card.title, ledger: Boolean(deps.collector), filing: Boolean(deps.file) && card.runId === undefined });
  if (!deps.file || card.runId !== undefined) {
    return;
  }
  let runId: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    runId = await Promise.race([
      deps.file(card),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          console.warn('card: filing is taking too long; it stays unfiled on screen', { ...deps.where, cardId: card.id, title: card.title });
          resolve(null);
        }, AUTO_FILE_MS);
      }),
    ]);
  } catch (err) {
    console.warn('card: filing failed; it stays unfiled on screen', { ...deps.where, cardId: card.id, title: card.title }, err);
  } finally {
    clearTimeout(timer);
  }
  if (runId !== null) {
    deps.collector?.onCardFiled(card.title, card.actions[0]?.actionId ?? '', runId);
    deps.write({ type: 'card_update', cardId: card.id, runId, state: 'filed' });
    console.warn('card: filed', { ...deps.where, cardId: card.id, runId });
  }
}

/**
 * The recommendation a filed card's proposal path still takes (`autoProposeRecommendation`).
 * @param card
 */
export function cardAsRecommendation(card: Card) {
  return recommendationFromCard(card);
}
