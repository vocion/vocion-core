import { describe, expect, it } from 'vitest';
import { cardFromRecommendation, cardKind, readCard, recommendationFromCard, registerCardKind } from './card';

describe('the card contract', () => {
  it('turns a recommendation into an action card and back without losing what the proposal path needs', () => {
    const card = cardFromRecommendation({ actionId: 'objects.propose_candidate', input: { objectType: 'request', title: 'Uploads drop on cellular' }, label: 'File this as a request', rationale: 'seven reports', confidence: 0.9, agentSlug: 'product-manager', suggestedDecision: 'approve', suggestedDecisionReason: 'a P1 bug' }, 'card_1');

    expect(card).toMatchObject({ id: 'card_1', kind: 'action', title: 'File this as a request', state: 'proposed', actions: [{ actionId: 'objects.propose_candidate', style: 'primary' }] });
    expect(recommendationFromCard(card)).toEqual({ id: 'card_1', state: 'proposed', actionId: 'objects.propose_candidate', input: { objectType: 'request', title: 'Uploads drop on cellular' }, label: 'File this as a request', rationale: 'seven reports', confidence: 0.9, agentSlug: 'product-manager', suggestedDecision: 'approve', suggestedDecisionReason: 'a P1 bug' });
  });

  it('a recommendation the server already filed is a filed card', () => {
    expect(cardFromRecommendation({ actionId: 'a', input: {}, label: 'x', runId: 3691 }, 'c')).toMatchObject({ runId: 3691, state: 'filed' });
  });

  it('refuses a card no kind claims, and a kind\'s own rule applies', () => {
    expect(readCard({ id: 'c', kind: 'hologram', title: 'x' })).toEqual({ ok: false, reason: 'no such card kind: hologram' });
    expect(readCard({ id: 'c', kind: 'action', title: 'x', actions: [] })).toEqual({ ok: false, reason: 'an action card needs at least one action' });
    expect(readCard({ id: 'c', kind: 'decision', title: 'x', actions: [{ label: 'Approve', actionId: 'a' }] })).toMatchObject({ ok: false });
    expect(readCard({ id: 'c', kind: 'record', title: 'Request #121' })).toMatchObject({ ok: true, card: { state: 'proposed', actions: [] } });
  });

  it('a plugin registers a kind by descriptor and it is checked like a core one', () => {
    registerCardKind({ kind: 'gate-verdict', renderer: 'gate-verdict', refine: c => (c.fields?.some(f => f.label === 'Gate') ? null : 'a gate verdict names its gate') });

    expect(cardKind('gate-verdict')?.renderer).toBe('gate-verdict');
    expect(readCard({ id: 'c', kind: 'gate-verdict', title: 'Returned to PM' })).toEqual({ ok: false, reason: 'a gate verdict names its gate' });
    expect(readCard({ id: 'c', kind: 'gate-verdict', title: 'Returned to PM', fields: [{ label: 'Gate', value: 'decision-ready' }] })).toMatchObject({ ok: true });
  });
});
