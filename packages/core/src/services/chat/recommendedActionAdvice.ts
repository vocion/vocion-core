/**
 * What a card filed from a conversation recommendation says about itself.
 *
 * The agent argued for this action in the conversation, so the recommendation
 * is real — filing it IS the ask — and the sentence beside it is the agent's
 * own rationale from that turn rather than wording core made up. An agent that
 * argued nothing gets a null pair: the card then carries no recommendation,
 * which is honest, and stays out of the agreement rate instead of crediting
 * the agent for a sentence it never wrote.
 *
 * It lives in its own module, apart from `autoPropose`, because two of its
 * three callers are client components: `autoPropose` reaches `ActionService`
 * and through it the database and `node:fs`, and importing from there pulled
 * that whole server graph into the browser bundle, which failed the
 * dashboard's build with "the chunking context does not support external
 * modules (request: node:fs/promises)". Nothing may be imported here.
 * @param rationale - The recommendation's own rationale, as the agent wrote it.
 */
export function recommendedActionAdvice(rationale: string | undefined): {
  suggestedDecision: 'approve' | null;
  suggestedDecisionReason: string | null;
} {
  const reason = rationale?.trim();
  if (!reason) {
    return { suggestedDecision: null, suggestedDecisionReason: null };
  }
  return { suggestedDecision: 'approve', suggestedDecisionReason: reason };
}
