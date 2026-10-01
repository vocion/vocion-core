import type { RuntimeContext } from '../types';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema } = await import('@/models/Schema');
const { connectHref, offerConnectionTool } = await import('./offerConnection');

const ORG = 'org_offer';
function ctxWith(emit: (event: unknown) => void): RuntimeContext {
  return { orgId: ORG, agentSlug: 'workspace-lead', conversationId: 7, connectorSources: [], emit } as unknown as RuntimeContext;
}

beforeAll(async () => {
  await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'slack', configJson: { _connector: 'slack' } });
});

describe('connectHref', () => {
  it('deep-links into the Sources add flow and back to this conversation', () => {
    expect(connectHref('github', 7)).toBe('/dashboard/connectors?add=github&returnTo=%2Fdashboard%2Fchat%3Fconversation%3D7');
  });
});

describe('offer_connection', () => {
  it('puts one link card in chat for a connector that is not connected', async () => {
    const emit = vi.fn();
    const out = await offerConnectionTool(ctxWith(emit)).invoke({ connector: 'github', why: 'So the factory can read Northwind\'s repos.' });

    expect(emit).toHaveBeenCalledTimes(1);

    const card = emit.mock.calls[0]![0].card;

    expect(card).toMatchObject({ kind: 'link', actions: [], href: connectHref('github', 7), state: 'proposed' });
    expect(String(out)).toContain('Do not claim it is connected');
  });

  it('refuses an unknown connector and shows no card', async () => {
    const emit = vi.fn();

    expect(String(await offerConnectionTool(ctxWith(emit)).invoke({ connector: 'ghosthub', why: 'x' }))).toMatch(/^Refused/);
    expect(emit).not.toHaveBeenCalled();
  });

  it('shows no card for a connector already connected', async () => {
    const emit = vi.fn();

    expect(String(await offerConnectionTool(ctxWith(emit)).invoke({ connector: 'slack', why: 'x' }))).toMatch(/already connected/);
    expect(emit).not.toHaveBeenCalled();
  });
});
