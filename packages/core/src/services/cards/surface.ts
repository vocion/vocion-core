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
import type { FiledCard } from '@/services/chat/autoPropose';
import type { RunCollector } from '@/services/chat/runCollector';
import { recommendationFromCard } from '@/libs/cards/card';

/** How long a card waits to be filed before it is shown unfiled — a card the person can press beats a filed one they never see. */
export const AUTO_FILE_MS = 8_000;

export type SurfaceDeps = {
  /** Writes an event to the wire (and the resume buffer). */
  write: (event: AgentEvent) => void;
  /** The turn's ledger; absent on a surface with no persisted conversation. */
  collector?: RunCollector | null;
  /** Files the card as a proposal and says what came of it, or null when it could not. Absent under ask-before-acting. */
  file?: (card: Card) => Promise<FiledCard | null>;
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
  deps.collector?.onCard({ id: card.id, kind: card.kind, label: card.title, actionId: card.actions[0]?.actionId ?? '', input: card.actions[0]?.input, runId: card.runId, state: card.state, ...(card.rationale ? { rationale: card.rationale } : {}), ...(card.body ? { body: card.body } : {}), ...(card.fields ? { fields: card.fields } : {}), href: card.href, hrefLabel: card.hrefLabel, secondaryHref: card.secondaryHref, secondaryHrefLabel: card.secondaryHrefLabel, lastAttempt: card.lastAttempt, ...(card.decision ? { decision: card.decision } : {}), ...(card.draft ? { draft: card.draft } : {}) });
  deps.write({ type: 'card', card });
  // One line per card lifecycle (backlog 025 § testable): a card that never
  // shows up in the log never showed up at all — that is how finding 18 was
  // established a day late.
  console.warn('card: surfaced', { ...deps.where, cardId: card.id, kind: card.kind, title: card.title, ledger: Boolean(deps.collector), filing: Boolean(deps.file) && card.runId === undefined });
  // A draft is not filed: it misses the bar as it stands, and its button
  // asks for the draft that would pass it.
  if (!deps.file || card.runId !== undefined || card.draft) {
    return;
  }
  // A CARD THAT SAID IT WOULD BE FILED SAYS WHETHER IT WAS. Conversation
  // 349 (2026-09-28): card_378208d4 surfaced with `filing: true`, the filing
  // came back empty (its error swallowed), no card_update followed, and the
  // card sat under "Waiting on you" — a promise with no action run behind
  // it. Every filing now ends in an update: filed, or `unfiled` with why.
  const TIMED_OUT = Symbol('timed out');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const filing = deps.file(card).then(
    filed => ({ filed, why: filed ? '' : 'the proposal was not accepted' }),
    (err: unknown) => ({ filed: null as FiledCard | null, why: (err as Error)?.message ?? 'filing failed' }),
  );
  const settle = (result: { filed: FiledCard | null; why: string }): void => {
    const { filed } = result;
    if (filed === null) {
      deps.collector?.onCardUnfiled(card.title, card.actions[0]?.actionId ?? '', result.why);
      deps.write({ type: 'card_update', cardId: card.id, state: 'unfiled', reason: result.why });
      console.warn('card: not filed', { ...deps.where, cardId: card.id, title: card.title, why: result.why });
      return;
    }
    // A card that ran on the spot (done-for-you) is decided, and the record
    // it created rides with it — so the next turn's replay says "created
    // request #126", not "filed as proposal #3722" (finding 24).
    const state = filed.status === 'done' ? 'decided' : 'filed';
    deps.collector?.onCardFiled(card.title, card.actions[0]?.actionId ?? '', filed.runId, { state, ref: filed.ref });
    deps.write({ type: 'card_update', cardId: card.id, runId: filed.runId, state, ...(filed.ref ? { ref: filed.ref } : {}) });
    console.warn('card: filed', { ...deps.where, cardId: card.id, runId: filed.runId, state, ref: filed.ref ?? null });
  };
  const first = await Promise.race([
    filing,
    new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), AUTO_FILE_MS);
    }),
  ]);
  clearTimeout(timer);
  if (first === TIMED_OUT) {
    // Slow is not failed: the card shows now, and the filing still reports
    // when it lands.
    console.warn('card: filing is taking too long; it stays unfiled on screen until it lands', { ...deps.where, cardId: card.id, title: card.title });
    void filing.then(settle);
    return;
  }
  settle(first);
}

/**
 * The recommendation a filed card's proposal path still takes (`autoProposeRecommendation`).
 * @param card
 */
export function cardAsRecommendation(card: Card) {
  return recommendationFromCard(card);
}
