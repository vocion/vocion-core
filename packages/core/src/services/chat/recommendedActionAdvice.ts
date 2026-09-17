/**
 * What a card filed from a conversation recommendation says about itself.
 *
 * Every review card carries a recommendation and a reason, and nothing here
 * has a model judging the card at the moment it is filed: the agent already
 * argued for the action in the conversation, and filing it IS the ask. So core
 * states that plainly rather than leaving the row with no opinion for the
 * agreement metric to measure. Shared with the two places a person can file
 * one by hand — `RecommendedActionCard` and `RecommendedActionStack` — so the
 * queue reads the same sentence however the card got there.
 *
 * It lives in its own module, apart from `autoPropose`, because both of those
 * callers are client components: `autoPropose` reaches `ActionService` and
 * through it the database and `node:fs`, and importing this constant from
 * there pulled that whole server graph into the browser bundle, which failed
 * the dashboard's build with "the chunking context does not support external
 * modules (request: node:fs/promises)". Nothing may be imported here.
 */
export const RECOMMENDED_ACTION_ADVICE = {
  suggestedDecision: 'approve' as const,
  suggestedDecisionReason: 'The agent recommended this action in the conversation and it is waiting to be carried out.',
};
