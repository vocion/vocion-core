/**
 * What a card filed from a conversation recommendation recommends.
 *
 * The rule under test: the verdict and the sentence on the card are the
 * agent's own, or the card carries neither. Core must never supply one and let
 * the agreement metric score it as though a model had made the call.
 */
import { describe, expect, it } from 'vitest';
import { recommendedActionAdvice } from './recommendedActionAdvice';

describe('recommendedActionAdvice', () => {
  it('carries the agent\'s own verdict and sentence through to the card', () => {
    const advice = recommendedActionAdvice({
      suggestedDecision: 'approve',
      suggestedDecisionReason: 'The renewal is 11 days out and nobody has replied to the last thread.',
    });

    expect(advice).toEqual({
      suggestedDecision: 'approve',
      suggestedDecisionReason: 'The renewal is 11 days out and nobody has replied to the last thread.',
    });
  });

  it('carries a verdict that is not an approve, rather than assuming the agent wants it run', () => {
    // The whole point of asking: an agent can surface something it thinks a
    // person should turn down, and the card has to say so.
    expect(recommendedActionAdvice({
      suggestedDecision: 'snooze',
      suggestedDecisionReason: 'Worth doing, but not before the contract is signed.',
    })).toEqual({
      suggestedDecision: 'snooze',
      suggestedDecisionReason: 'Worth doing, but not before the contract is signed.',
    });
  });

  it('recommends nothing when the agent stated nothing', () => {
    expect(recommendedActionAdvice({})).toEqual({ suggestedDecision: null, suggestedDecisionReason: null });
  });

  it('recommends nothing when a verdict arrived with no sentence a reviewer could check', () => {
    expect(recommendedActionAdvice({ suggestedDecision: 'approve' })).toEqual({ suggestedDecision: null, suggestedDecisionReason: null });
  });

  it('treats a blank sentence as nothing said, rather than an empty line on the card', () => {
    expect(recommendedActionAdvice({ suggestedDecision: 'approve', suggestedDecisionReason: '   \n  ' }))
      .toEqual({ suggestedDecision: null, suggestedDecisionReason: null });
  });

  it('drops a sentence with no verdict, which would argue for an outcome the card never names', () => {
    expect(recommendedActionAdvice({ suggestedDecisionReason: 'Drafts are ready.' }))
      .toEqual({ suggestedDecision: null, suggestedDecisionReason: null });
  });

  it('trims the sentence it carries, so the card never renders leading whitespace', () => {
    expect(recommendedActionAdvice({ suggestedDecision: 'approve', suggestedDecisionReason: '  Drafts are ready.  ' }).suggestedDecisionReason)
      .toBe('Drafts are ready.');
  });
});
