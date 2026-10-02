import { describe, expect, it } from 'vitest';
import { cardFromRecommendation, cardKind, readCard, recommendationFromCard, registerCardKind } from './card';

function opt(id: string, extra: Record<string, unknown> = {}) {
  return { id, label: `Option ${id}`, ...extra };
}

function choice(options: unknown[], extra: Record<string, unknown> = {}) {
  return { id: 'c', kind: 'choice', title: 'What do you want me taking off your plate?', options, ...extra };
}

function boundActions(count: number) {
  return Array.from({ length: count }, (_, index) => ({ actionId: `a${index}` }));
}

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

  it('carries the page of the record a card is about, both ways', () => {
    const card = cardFromRecommendation({ actionId: 'factory.dispatch_task', input: { requestId: 201 }, label: 'Approve build: link expiry', href: '/w/kestrel/dashboard/p/feature/201', hrefLabel: 'Open feature' }, 'card_2');

    expect(card).toMatchObject({ href: '/w/kestrel/dashboard/p/feature/201', hrefLabel: 'Open feature' });
    expect(recommendationFromCard(card)).toMatchObject({ href: '/w/kestrel/dashboard/p/feature/201', hrefLabel: 'Open feature' });
  });

  it('a link card needs an href; with one it reads', () => {
    const base = { id: 'card_l', kind: 'link', title: 'Connect GitHub', actions: [], source: {}, state: 'proposed' };

    expect(readCard(base).ok).toBe(false);
    expect(readCard({ ...base, href: '/dashboard/connectors?add=github' }).ok).toBe(true);
  });

  describe('the choice card', () => {
    it('accepts two lettered options, with bound actions and an answer', () => {
      const checked = readCard(choice([opt('A', { actions: [{ actionId: 'tracker.close', input: { id: 1 } }] }), opt('B')], { answer: { optionId: 'other', text: 'Release notes', at: '2026-10-02T09:00:00.000Z' } }));

      expect(checked).toMatchObject({ ok: true, card: { options: [{ id: 'A', actions: [{ actionId: 'tracker.close', input: { id: 1 } }] }, { id: 'B' }], answer: { optionId: 'other' } } });
    });

    it('refuses one option, five options, a gap in the letters and a card-level action', () => {
      expect(readCard(choice([opt('A')]))).toMatchObject({ ok: false });
      expect(readCard(choice([opt('A'), opt('B'), opt('C'), opt('D'), opt('E')]))).toMatchObject({ ok: false });
      expect(readCard(choice([opt('A'), opt('C')]))).toMatchObject({ ok: false, reason: expect.stringContaining('A, B') });
      expect(readCard(choice([opt('B'), opt('A')]))).toMatchObject({ ok: false });
      expect(readCard(choice([opt('A'), opt('B')], { actions: [{ label: 'Go', actionId: 'a' }] }))).toMatchObject({ ok: false, reason: expect.stringContaining('options') });
    });

    it('refuses an option that binds 21 actions, and one that binds none', () => {
      expect(readCard(choice([opt('A', { actions: boundActions(20) }), opt('B')])).ok).toBe(true);
      expect(readCard(choice([opt('A', { actions: boundActions(21) }), opt('B')])).ok).toBe(false);
      expect(readCard(choice([opt('A', { actions: [] }), opt('B')])).ok).toBe(false);
    });

    it('the old ask kind is gone', () => {
      expect(cardKind('ask')).toBeUndefined();
      expect(cardKind('choice')).toMatchObject({ renderer: 'choice' });
    });
  });
});
