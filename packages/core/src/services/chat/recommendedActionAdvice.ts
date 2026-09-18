/**
 * What a card filed from a conversation recommendation recommends.
 *
 * The agent answers this itself: `recommend_action` asks for a verdict and one
 * short sentence, and both travel on the recommendation. This only reads them
 * back, because filing the card is a separate moment from making the
 * recommendation and the two places a person can file one — the card and the
 * stack — must not each invent their own answer.
 *
 * A recommendation that arrived without them (an older client, a model that
 * skipped the field) files with no recommendation at all. That is deliberate:
 * a verdict core supplies is scored in the agreement rate as though the agent
 * had made it, which flatters the agent for wording it never wrote.
 *
 * It lives in its own module, apart from `autoPropose`, because two of its
 * three callers are client components: `autoPropose` reaches `ActionService`
 * and through it the database and `node:fs`, and importing from there pulled
 * that whole server graph into the browser bundle, which failed the
 * dashboard's build with "the chunking context does not support external
 * modules (request: node:fs/promises)". Nothing may be imported here.
 * @param rec - The recommendation, as the agent emitted it.
 * @param rec.suggestedDecision - The agent's verdict, when it gave one.
 * @param rec.suggestedDecisionReason - Its one-sentence why.
 */
export function recommendedActionAdvice(rec: {
  suggestedDecision?: 'approve' | 'reject' | 'snooze';
  suggestedDecisionReason?: string;
}): {
  suggestedDecision: 'approve' | 'reject' | 'snooze' | null;
  suggestedDecisionReason: string | null;
} {
  const reason = rec.suggestedDecisionReason?.trim();
  if (!rec.suggestedDecision || !reason) {
    return { suggestedDecision: null, suggestedDecisionReason: null };
  }
  return { suggestedDecision: rec.suggestedDecision, suggestedDecisionReason: reason };
}
