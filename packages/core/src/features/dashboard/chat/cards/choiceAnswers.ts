import type { CardAnswer, ChatMessage, RecommendedAction } from '../types';

/**
 * Pure edits to the transcript for a choice card's answer (#1028).
 *
 * The card lives in an EARLIER assistant message than the turn the answer
 * starts, so these walk every row instead of only the latest one.
 */

/**
 * One card changed wherever it sits in the transcript; every other card and
 * row is returned as it was.
 * @param messages - The transcript.
 * @param cardId - The card to change.
 * @param change - Returns the card as it should now read.
 */
export function updateCardEverywhere(messages: ChatMessage[], cardId: string, change: (rec: RecommendedAction) => RecommendedAction): ChatMessage[] {
  return messages.map(m => (m.recommendations?.some(r => r.id === cardId)
    ? { ...m, recommendations: m.recommendations.map(r => (r.id === cardId ? change(r) : r)) }
    : m));
}

/**
 * The card shown as answered at once, before the server has said so, so a
 * second tap has nothing to land on. The server's own `card_update` replaces
 * this with the stored answer.
 * @param messages - The transcript.
 * @param cardId - The card being answered.
 * @param answer - The answer to show.
 */
export function withCardAnswer(messages: ChatMessage[], cardId: string, answer: CardAnswer): ChatMessage[] {
  return updateCardEverywhere(messages, cardId, ({ answerRefused: _dropped, ...rec }) => ({ ...rec, state: 'decided', answer }));
}

/**
 * The card put back to open, with the server's sentence on it, after the
 * server refused the answer.
 * @param messages - The transcript.
 * @param cardId - The card that was refused.
 * @param error - The sentence to show on the card.
 * @param at - A stamp that makes this refusal distinct from the last one.
 */
export function withRefusedAnswer(messages: ChatMessage[], cardId: string, error: string, at: number): ChatMessage[] {
  return updateCardEverywhere(messages, cardId, ({ answer: _dropped, ...rec }) => ({ ...rec, state: 'proposed', answerRefused: { error, at } }));
}

/**
 * What to tell the person when the stream route refused an answer before any
 * turn started: the server's own sentence, else plain words for the status.
 * @param status - The HTTP status.
 * @param body - The parsed JSON body, or null when it was not JSON.
 */
export function refusalSentence(status: number, body: { error?: unknown } | null): string {
  if (typeof body?.error === 'string' && body.error.trim()) {
    return body.error;
  }
  return status === 404 ? 'That question is no longer in this conversation.' : 'That answer could not be sent. Try again.';
}
