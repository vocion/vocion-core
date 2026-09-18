/**
 * Which grader's number the agent card shows.
 *
 * The card sits beside two vote-based numbers and claims to be the one nobody
 * voted on. Showing whichever grader happened to sort first would quietly make
 * that claim false the day a third grader arrives.
 */
import type { AdoptionAgentEvalScore } from '@/services/adoption/AdoptionService';
import { describe, expect, it } from 'vitest';
import { pickTechnicalEvalScore } from './evalScore';

function score(provider: string, passRate: number): AdoptionAgentEvalScore {
  return {
    provider,
    datasetSlug: 'refund-quality',
    runId: 1,
    passRate,
    ranAt: '2026-09-15T10:00:00.000Z',
  };
}

describe('pickTechnicalEvalScore', () => {
  it('prefers the grader that judges tool use over the one that judges answers', () => {
    const picked = pickTechnicalEvalScore([score('vocion', 0.9), score('agentcore', 0.4)]);

    expect(picked?.provider).toBe('agentcore');
  });

  it('does not depend on the order the scores arrive in', () => {
    const picked = pickTechnicalEvalScore([score('agentcore', 0.4), score('vocion', 0.9)]);

    expect(picked?.provider).toBe('agentcore');
  });

  it('still shows our own judge when no technical grader has run', () => {
    const picked = pickTechnicalEvalScore([score('vocion', 0.9)]);

    // Hiding the number entirely would read as "never evaluated", which is a
    // different and wronger thing to say.
    expect(picked?.provider).toBe('vocion');
  });

  it('has nothing to show for an agent with no eval runs', () => {
    expect(pickTechnicalEvalScore([])).toBeNull();
  });
});
