import { describe, expect, it, vi } from 'vitest';
import { deckCreateAction } from './deck-create';

/** Making a deck in the workspace's Gamma account. The key is a fixture. */

const made: { key: string; request: Record<string, unknown> }[] = [];

vi.mock('@/libs/gamma/client', () => ({
  gammaKeyFor: async (orgId: string) => (orgId === 'org_a' ? 'sk-gamma-a-0000000000' : null),
  createGeneration: async (key: string, request: Record<string, unknown>) => {
    made.push({ key, request });
    return { generationId: 'gen_7' };
  },
  waitForGeneration: async () => ({ generationId: 'gen_7', status: 'completed', gammaUrl: 'https://gamma.app/docs/gen_7' }),
}));

describe('deck.create', () => {
  it('has no Undo, because Gamma\'s API cannot delete a deck, and says so on the card', async () => {
    expect(deckCreateAction.undo).toBeUndefined();

    const card = await deckCreateAction.reviewCard!({ orgId: 'org_a' }, { title: 'Q3 for Kestrel Capital', content: 'Revenue up.' });

    expect(card.headline).toMatch(/spending Gamma credits\. The deck stays in Gamma/);
  });

  it('refuses at the door without a Gamma account', async () => {
    await expect(deckCreateAction.precheck!({ orgId: 'org_none' }, { title: 't', content: 'c' })).resolves.toMatch(/Connect Gamma/);
  });

  it('makes the deck on the workspace\'s key and links it', async () => {
    const out = await deckCreateAction.execute({ orgId: 'org_a' }, { title: 'Q3 for Kestrel Capital', content: 'Revenue up.', numCards: 6 });

    expect(out).toMatchObject({ created: true, url: 'https://gamma.app/docs/gen_7' });
    expect(made[0]).toEqual({ key: 'sk-gamma-a-0000000000', request: { inputText: '# Q3 for Kestrel Capital\n\nRevenue up.', textMode: 'condense', format: 'presentation', numCards: 6 } });
  });
});
