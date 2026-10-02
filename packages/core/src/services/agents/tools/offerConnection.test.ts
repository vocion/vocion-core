import type { RuntimeContext } from '../types';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const { db } = await import('@/libs/DB');
const { accountMembershipSchema, knowledgeSourceSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { storeLoginCredential } = await import('@/services/ApiTokenService');
const { recordConnectAttempt } = await import('@/libs/connect/attempts');
const { connectHref, credentialHref, offerConnectionTool } = await import('./offerConnection');

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
  it('a login-capable connector gets a card whose button starts the login, carrying its own id', async () => {
    const emit = vi.fn();
    const out = await offerConnectionTool(ctxWith(emit)).invoke({ connector: 'github', why: 'So the factory can read Northwind\'s repos.' });

    expect(emit).toHaveBeenCalledTimes(1);

    const card = emit.mock.calls[0]![0].card;
    const href = new URL(card.href, 'https://app.example');

    expect(href.pathname).toBe('/api/connect/github/start');
    expect(card.href.startsWith('/api/connect/github/start?connector=github')).toBe(true);
    expect(href.searchParams.get('card')).toBe(card.id);
    expect(href.searchParams.get('conversation')).toBe('7');
    expect(href.searchParams.get('returnTo')).toBe('/dashboard/chat?conversation=7');
    expect(card).toMatchObject({
      kind: 'link',
      title: 'Connect GitHub',
      hrefLabel: 'Connect GitHub',
      secondaryHref: '/dashboard/connectors?add=github&paste=1&returnTo=%2Fdashboard%2Fchat%3Fconversation%3D7',
      secondaryHrefLabel: 'Paste a token',
      actions: [],
      state: 'proposed',
      rationale: 'So the factory can read Northwind\'s repos.',
    });
    expect(card.body).toMatch(/^Asks for: .+/);
    expect(card.lastAttempt).toBeUndefined();
    expect(JSON.stringify(card)).not.toMatch(/approve/i);
    expect(String(out)).toContain('Do not claim it is connected');
  });

  it('a failed attempt recorded earlier rides on the card with its date', async () => {
    await recordConnectAttempt({ orgId: ORG, userId: 'usr-admin', provider: 'github', providerLabel: 'GitHub', connector: 'github', ok: false, reason: 'access_denied' });
    const emit = vi.fn();
    await offerConnectionTool(ctxWith(emit)).invoke({ connector: 'github', why: 'x' });

    const card = emit.mock.calls[0]![0].card;

    expect(card.lastAttempt).toMatchObject({ reason: 'access_denied', summary: 'GitHub denied access' });
    expect(Number.isNaN(Date.parse(card.lastAttempt.at))).toBe(false);
  });

  it('a connector with no login provider keeps the Connectors link', async () => {
    const emit = vi.fn();
    await offerConnectionTool(ctxWith(emit)).invoke({ connector: 'apollo', why: 'x' });

    const card = emit.mock.calls[0]![0].card;

    expect(card).toMatchObject({ href: connectHref('apollo', 7), hrefLabel: 'Connect Apollo' });
    expect(card.secondaryHref).toBeUndefined();
    expect(card.body).toBeUndefined();
  });

  it('already logged in and no source: no card, and the text points at browse_connection', async () => {
    await storeLoginCredential({ orgId: ORG, platform: 'github', name: 'GitHub - northwind', account: 'northwind', values: { installationId: '42', token: 'ghs_not_a_real_token' }, createdBy: 'usr-admin' });
    const emit = vi.fn();
    const out = String(await offerConnectionTool(ctxWith(emit)).invoke({ connector: 'github', why: 'x' }));

    expect(emit).not.toHaveBeenCalled();
    expect(out).toBe('Already logged in to GitHub as northwind. Call browse_connection to offer what it can see, then save the pick with source.connect.');
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

describe('offer_connection for a platform with no connector', () => {
  it('app-login gets a card to the Developers page that returns to this conversation', async () => {
    const emit = vi.fn();
    const out = String(await offerConnectionTool(ctxWith(emit)).invoke({ connector: 'app-login', why: 'So QA can sign in to Northwind.' }));
    const card = emit.mock.calls[0]![0].card;

    expect(card).toMatchObject({ kind: 'link', title: 'Connect App sign-in', actions: [], state: 'proposed', href: '/dashboard/developers?add=app-login&returnTo=%2Fdashboard%2Fchat%3Fconversation%3D7' });
    expect(card.href).toBe(credentialHref('app-login', 7));
    expect(out).toMatch(/Never ask for it in chat/);
  });

  it('a member gets no card, and a platform that is neither a connector nor pasteable is still refused', async () => {
    const emit = vi.fn();

    expect(String(await offerConnectionTool(ctxWith(emit, 'usr-member')).invoke({ connector: 'app-login', why: 'x' }))).toMatch(/^Only a workspace admin can add App sign-in/);
    // `vocion` is a real platform with no pasteable credential; `ghosthub` is nothing.
    expect(String(await offerConnectionTool(ctxWith(emit)).invoke({ connector: 'vocion', why: 'x' }))).toMatch(/^Refused/);
    expect(String(await offerConnectionTool(ctxWith(emit)).invoke({ connector: 'ghosthub', why: 'x' }))).toMatch(/^Refused/);
    expect(emit).not.toHaveBeenCalled();
  });
});
