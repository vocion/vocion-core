import type { RuntimeContext } from '../types';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const { db } = await import('@/libs/DB');
const { accountMembershipSchema, knowledgeSourceSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { connectHref, offerConnectionTool } = await import('./offerConnection');

const ORG = 'org_offer';
function ctxWith(emit: (event: unknown) => void, userId: string | null = 'usr-admin'): RuntimeContext {
  return { orgId: ORG, userId: userId ?? undefined, agentSlug: 'workspace-lead', conversationId: 7, connectorSources: [], emit } as unknown as RuntimeContext;
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct_offer', name: 'Northwind', slug: 'northwind-offer' } as never);
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct_offer', slug: 'offer', name: 'Northwind' } as never);
  await db.insert(userSchema).values([
    { id: 'usr-admin', name: 'Ada', email: 'ada@northwind.example' },
    { id: 'usr-member', name: 'Max', email: 'max@northwind.example' },
  ] as never);
  await db.insert(accountMembershipSchema).values([
    { accountId: 'acct_offer', userId: 'usr-admin', role: 'admin' },
    { accountId: 'acct_offer', userId: 'usr-member', role: 'member' },
  ]);
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

    expect(card).toMatchObject({ kind: 'link', actions: [], href: connectHref('github', 7), state: 'proposed', rationale: 'So the factory can read Northwind\'s repos.' });
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

  it('a member gets no card, since the connect flow is admin-only', async () => {
    const emit = vi.fn();
    const out = String(await offerConnectionTool(ctxWith(emit, 'usr-member')).invoke({ connector: 'github', why: 'x' }));

    expect(out).toMatch(/^Only a workspace admin can connect .+\. Ask an admin to connect it from Sources\.$/);
    expect(emit).not.toHaveBeenCalled();
  });

  it('fails safe: no user, or a stranger to the account, gets no card', async () => {
    const emit = vi.fn();

    expect(String(await offerConnectionTool(ctxWith(emit, null)).invoke({ connector: 'github', why: 'x' }))).toMatch(/^Only a workspace admin/);
    expect(String(await offerConnectionTool(ctxWith(emit, 'usr-nobody')).invoke({ connector: 'github', why: 'x' }))).toMatch(/^Only a workspace admin/);
    expect(emit).not.toHaveBeenCalled();
  });
});
