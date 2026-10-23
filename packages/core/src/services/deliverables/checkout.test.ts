import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// The round trip is about versions, not pixels: render-verify is the render
// tests' job, so the engine records "renderer unavailable" here and moves on.
vi.mock('@/libs/documents/render', async orig => ({ ...(await orig<object>()), renderAvailable: async () => ({ ok: false, reason: 'not in this test' }) }));

const { createDeck, reviseDeck, verifyDeckArtifact } = await import('@/services/decks/DeckEngine');
const { checkinDeliverable, checkoutDeliverable } = await import('./checkout');
const { getArtifact } = await import('@/services/ArtifactService');

const ORG = 'org_deck_checkout_test';
const AGENT = { kind: 'agent' as const, id: 'agent:proposal-writer' };
const s = (id: string, body: string) => `<section id="${id}" style="padding:120px">${body}<aside>From the Contoso Supply kickoff.</aside></section>`;

async function newDeck() {
  const { artifact } = await createDeck({
    orgId: ORG,
    author: AGENT,
    deck: {
      title: 'Contoso Supply — concept',
      order: ['cover', 'plan'],
      slides: { cover: s('cover', '<h1>One record</h1>'), plan: s('plan', '<h2>The plan</h2><p>Three phases.</p>') },
      playbook: 'concept',
    },
  });
  return artifact;
}

describe('deck check-out and check-in', () => {
  it('checks a deck out as deck.json + slides, and back in as a new version', async () => {
    const deck = await newDeck();
    const out = await checkoutDeliverable({ orgId: ORG, id: deck.id });

    expect(out).toMatchObject({ kind: 'deck', baseVersion: 1, format: 'vocion-deck/1' });
    expect(Object.keys(out.files).sort()).toEqual(['deck.json', 'slides/cover.html', 'slides/plan.html']);
    expect(JSON.parse(out.files['deck.json']!)).toMatchObject({ format: 'vocion-deck/1', order: ['cover', 'plan'], playbook: 'concept' });

    const files = { ...out.files, 'slides/plan.html': out.files['slides/plan.html']!.replace('Three phases.', 'Two phases.') };
    const res = await checkinDeliverable({ orgId: ORG, id: deck.id, baseVersion: out.baseVersion, files, author: AGENT, tool: 'Claude' });

    expect(res.status).toBe('written');

    const row = await getArtifact({ orgId: ORG, id: deck.id });

    expect(row!.currentVersion).toBe(2);
    expect((row!.spec as { slides: Record<string, string> }).slides.plan).toContain('Two phases.');
    expect((row!.spec as { origin?: unknown }).origin).toEqual({ kind: 'checkout', tool: 'Claude', baseVersion: 1 });
    expect((row!.spec as { playbook?: string }).playbook).toBe('concept');
  });

  it('refuses a stale check-in with the slide-by-slide diff of what changed in Vocion', async () => {
    const deck = await newDeck();
    const out = await checkoutDeliverable({ orgId: ORG, id: deck.id });
    await reviseDeck({ orgId: ORG, id: deck.id, author: AGENT, changeSummary: 'tightened the plan', ops: [{ op: 'replace_text', find: 'Three phases.', replace: 'Three phases, twelve weeks.' }] });

    const res = await checkinDeliverable({ orgId: ORG, id: deck.id, baseVersion: out.baseVersion, files: out.files, author: AGENT });

    expect(res.status).toBe('stale');
    expect(res.status === 'stale' && res.diff).toContain('~ Slide 2 [plan] (The plan): "The plan Three phases." → "The plan Three phases, twelve weeks."');
    expect((await getArtifact({ orgId: ORG, id: deck.id }))!.currentVersion).toBe(2);
  });

  it('a verify recorded since the check-out does not make it stale, and identical files change nothing', async () => {
    const deck = await newDeck();
    const out = await checkoutDeliverable({ orgId: ORG, id: deck.id });
    await verifyDeckArtifact({ orgId: ORG, id: deck.id });

    expect(await checkinDeliverable({ orgId: ORG, id: deck.id, baseVersion: out.baseVersion, files: out.files, author: AGENT })).toEqual({ status: 'unchanged', version: 2 });
  });

  it('accepts a Claude Slides project and converts it', async () => {
    const deck = await newDeck();
    const out = await checkoutDeliverable({ orgId: ORG, id: deck.id, format: 'claude-slides' });

    expect(Object.keys(out.files)).toContain('project/deck.json');

    const files = { ...out.files, 'project/slides/cover.html': out.files['project/slides/cover.html']!.replace('One record', 'One record, every site') };
    const res = await checkinDeliverable({ orgId: ORG, id: deck.id, baseVersion: out.baseVersion, files, author: AGENT });

    expect(res.status).toBe('written');
    expect(res.status === 'written' && res.kind === 'deck' && res.spec.slides.cover).toContain('every site');
    expect(res.status === 'written' && res.kind === 'deck' && res.spec.origin?.tool).toBe('Claude Slides');
  });
});
