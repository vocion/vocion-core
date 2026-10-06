import type { RuntimeContext } from '../types';
import type { connectOptionFor } from '@/libs/connect/registry';
import type * as RealRegistry from '@/libs/connect/registry';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

/**
 * Which login apps this test's server has: every provider is set up unless a
 * test takes it away, whatever the developer's .env holds, so the tests read
 * the same on a laptop and in CI.
 */
const providerSetup = vi.hoisted(() => ({ unconfigured: new Set<string>() }));

/**
 * The connect option as this test's server has it.
 * @param option - The real option.
 */
function setUpForTest(option: ReturnType<typeof connectOptionFor>): ReturnType<typeof connectOptionFor> {
  return option && { ...option, configured: !providerSetup.unconfigured.has(option.provider) };
}

vi.mock('@/libs/connect/registry', async (importOriginal) => {
  const real = await importOriginal<typeof RealRegistry>();
  return { ...real, connectOptionFor: (slug: string) => setUpForTest(real.connectOptionFor(slug)) };
});
const { db } = await import('@/libs/DB');
const { accountMembershipSchema, apiTokenSchema, knowledgeSourceSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { storeLoginCredential } = await import('@/services/ApiTokenService');
const { recordConnectAttempt } = await import('@/libs/connect/attempts');
const { connectHref, offerConnectionTool, pasteHref } = await import('./offerConnection');

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
  const slackLogin = await storeLoginCredential({ orgId: ORG, platform: 'slack', name: 'Slack - northwind', account: 'northwind', values: { token: 'xoxb-not-a-real-token' }, createdBy: 'usr-admin' });
  await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'slack', configJson: { _connector: 'slack' }, apiTokenId: slackLogin.id });
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
    expect(card.body).toMatch(/^Asks for: .+\. After logging in you choose: repositories\.$/);
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

  it('a login this server has no app for is offered as paste, never as a login button that can only fail', async () => {
    providerSetup.unconfigured.add('github');
    try {
      const emit = vi.fn();
      await offerConnectionTool(ctxWith(emit)).invoke({ connector: 'github', why: 'x' });

      expect(emit.mock.calls[0]![0].card.href).toBe(pasteHref('github', 7));
    } finally {
      providerSetup.unconfigured.delete('github');
    }
  });

  it('a connector with no login provider opens its token form and says what to paste and the access it needs', async () => {
    const emit = vi.fn();
    await offerConnectionTool(ctxWith(emit)).invoke({ connector: 'sentry', why: 'x' });

    const card = emit.mock.calls[0]![0].card;

    expect(card).toMatchObject({ href: pasteHref('sentry', 7), hrefLabel: 'Connect Sentry' });
    expect(card.href).toBe('/dashboard/connectors?add=sentry&paste=1&returnTo=%2Fdashboard%2Fchat%3Fconversation%3D7');
    expect(card.secondaryHref).toBeUndefined();
    expect(card.body).toContain('Auth token');
    expect(card.body).toContain('org:read');
  });

  it('names what to paste with the article English needs, so chat says "Paste an API key", never "Paste a API key"', async () => {
    const emit = vi.fn();
    await offerConnectionTool(ctxWith(emit)).invoke({ connector: 'elevenlabs', why: 'x' });

    expect(emit.mock.calls[0]![0].card.body).toMatch(/^Paste an API key\. It needs: Text to Speech; /);
  });

  it('Google Ads, on the same platform as Gmail, gets the token form, because its API also needs a developer token no login can issue', async () => {
    const emit = vi.fn();
    await offerConnectionTool(ctxWith(emit)).invoke({ connector: 'google-ads', why: 'x' });

    expect(emit.mock.calls[0]![0].card.href).toBe(pasteHref('google-ads', 7));
  });

  it('a connector with no connect declaration falls back to the plain Connectors link', async () => {
    const emit = vi.fn();
    await offerConnectionTool(ctxWith(emit)).invoke({ connector: 'web', why: 'x' });

    const card = emit.mock.calls[0]![0].card;

    expect(card).toMatchObject({ href: connectHref('web', 7) });
    expect(card.body).toBeUndefined();
  });

  it('tells the agent what happens after the login, per connector', async () => {
    const emit = vi.fn();
    const out = String(await offerConnectionTool(ctxWith(emit)).invoke({ connector: 'github', why: 'x' }));

    expect(out).toContain('ask which repositories they want');
    expect(out).toContain('source.connect');
    expect(out).not.toMatch(/set-?up/i);
  });

  it('reads what the login still needs from the declaration: Jira asks for a site and project keys, Slack for nothing', async () => {
    const jira = vi.fn();
    const jiraText = String(await offerConnectionTool(ctxWith(jira)).invoke({ connector: 'jira', why: 'x' }));

    expect(jira.mock.calls[0]![0].card.body).toContain('After logging in you choose: site, project keys.');
    expect(jiraText).toContain('ask which site and project keys they want');

    const slack = vi.fn();
    const [source] = await db.select().from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.slug, 'slack'));
    await db.update(apiTokenSchema).set({ revokedAt: new Date() }).where(eq(apiTokenSchema.id, source!.apiTokenId!));
    const slackText = String(await offerConnectionTool(ctxWith(slack)).invoke({ connector: 'slack', why: 'x' }));

    expect(slack.mock.calls[0]![0].card.body).toContain('Logging in is all it takes');
    expect(slackText).toContain('the login creates its source');

    await db.update(apiTokenSchema).set({ revokedAt: null }).where(eq(apiTokenSchema.id, source!.apiTokenId!));
  });

  it('already logged in and no source: no card, and the text asks which repos to sync', async () => {
    await storeLoginCredential({ orgId: ORG, platform: 'github', name: 'GitHub - northwind', account: 'northwind', values: { installationId: '42', token: 'ghs_not_a_real_token' }, createdBy: 'usr-admin' });
    const emit = vi.fn();
    const out = String(await offerConnectionTool(ctxWith(emit)).invoke({ connector: 'github', why: 'x' }));

    expect(emit).not.toHaveBeenCalled();
    expect(out).toBe('Already logged in to GitHub as northwind. Ask which repositories they want, then save the source with source.connect.');
  });

  it('a Google login made for Drive does not count as logged in for Gmail: the card offers the Google login again', async () => {
    await storeLoginCredential({ orgId: ORG, platform: 'google', name: 'Google - ops', account: 'ops@northwind.example', values: { accessToken: 'ya29.not-real', refreshToken: '1//not-real', expiresAt: '2026-10-05T18:00:00.000Z', scope: 'openid email https://www.googleapis.com/auth/drive.readonly' }, createdBy: 'usr-admin' });
    const emit = vi.fn();
    const out = String(await offerConnectionTool(ctxWith(emit)).invoke({ connector: 'gmail', why: 'x' }));

    expect(out).not.toContain('Already logged in');
    expect(emit.mock.calls[0]![0].card.href).toMatch(/^\/api\/connect\/google\/start\?connector=gmail/);
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

  it('offers the login again once the source\'s credential is revoked or expired', async () => {
    const emit = vi.fn();
    const [source] = await db.select().from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.slug, 'slack'));

    await db.update(apiTokenSchema).set({ revokedAt: new Date() }).where(eq(apiTokenSchema.id, source!.apiTokenId!));
    const revoked = String(await offerConnectionTool(ctxWith(emit)).invoke({ connector: 'slack', why: 'x' }));

    expect(revoked).toContain('Showed a "Connect Slack" card');
    expect(emit).toHaveBeenCalledTimes(1);

    await db.update(apiTokenSchema).set({ revokedAt: null, expiresAt: new Date(Date.now() - 60_000) }).where(eq(apiTokenSchema.id, source!.apiTokenId!));
    await offerConnectionTool(ctxWith(emit)).invoke({ connector: 'slack', why: 'x' });

    expect(emit).toHaveBeenCalledTimes(2);

    await db.update(apiTokenSchema).set({ expiresAt: null }).where(eq(apiTokenSchema.id, source!.apiTokenId!));
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
