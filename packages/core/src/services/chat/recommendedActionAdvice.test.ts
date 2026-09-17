/**
 * What a card filed from a conversation recommendation recommends.
 *
 * The rule under test: the sentence on the card is the agent's own, or there
 * is no recommendation at all. Core must never supply wording and let the
 * agreement metric score it as though a model had made the call.
 */
import { describe, expect, it } from 'vitest';
import { recommendedActionAdvice } from './recommendedActionAdvice';

describe('recommendedActionAdvice', () => {
  it('recommends approving, in the agent\'s own words, when the agent argued for it', () => {
    const advice = recommendedActionAdvice('The renewal is 11 days out and nobody has replied to the last thread.');

    expect(advice).toEqual({
      suggestedDecision: 'approve',
      suggestedDecisionReason: 'The renewal is 11 days out and nobody has replied to the last thread.',
    });
  });

  it('recommends nothing when the agent gave no rationale', () => {
    expect(recommendedActionAdvice(undefined)).toEqual({ suggestedDecision: null, suggestedDecisionReason: null });
  });

  it('treats a blank rationale as nothing said, rather than an empty sentence on the card', () => {
    expect(recommendedActionAdvice('   \n  ')).toEqual({ suggestedDecision: null, suggestedDecisionReason: null });
  });

  it('trims the sentence it carries, so the card never renders leading whitespace', () => {
    expect(recommendedActionAdvice('  Drafts are ready.  ').suggestedDecisionReason).toBe('Drafts are ready.');
  });
});
