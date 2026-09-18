/**
 * Which eval score the agent row shows, when several graders have one.
 *
 * The card sits beside agreement and approval, which are both votes. Its job
 * is to be the number nobody voted on, and the grader that answers that best
 * is the one grading tool trajectories rather than answer quality — AgentCore
 * today. Picking it by name rather than taking the first row means a third
 * grader arriving does not silently change which number this card shows.
 */

import type { AdoptionAgentEvalScore } from '@/services/adoption/AdoptionService';

/** The grader whose score answers "did it do the right thing", in preference order. */
const TECHNICAL_PROVIDERS = ['agentcore'];

/**
 * The score to show for one agent, or null when it has none.
 * @param scores - Every grader's latest score for this agent.
 */
export function pickTechnicalEvalScore(scores: AdoptionAgentEvalScore[]): AdoptionAgentEvalScore | null {
  for (const providerId of TECHNICAL_PROVIDERS) {
    const match = scores.find(score => score.provider === providerId);
    if (match) {
      return match;
    }
  }
  // No technical grader has scored this agent: our own judge's number is still
  // worth showing, and the card names whichever grader produced it.
  return scores[0] ?? null;
}
