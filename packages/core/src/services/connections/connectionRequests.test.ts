/**
 * Connection requests (backlog 053) against an in-memory database and a
 * stubbed GitHub: one card per account however many repositories are asked
 * for; asking again refreshes it; a repository already reachable raises
 * nothing; the install landing closes it, done, by the system; a request the
 * person turned down is not raised again by the machinery; and
 * `request_connection` in chat puts up the card, already filed, carrying the
 * install link. Fictional accounts and keys throughout.
 */
import type { RuntimeContext } from '@/services/agents/types';
import { Buffer } from 'node:buffer';
import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', Buffer.from('k'.repeat(32)).toString('base64'));
vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://vocion.northwind.example');

const { db } = await import('@/libs/DB');
const { askSchema, githubAppSchema, githubInstallationSchema } = await import('@/models/Schema');
const { eq } = await import('drizzle-orm');
const requests = await import('./connectionRequests');
const svc = await import('@/services/github/GithubAppService');
const { decideAsk } = await import('@/services/AskService');
const { buildDomainTools } = await import('@/services/agents/tools/registry');

const ORG = 'org_northwind_factory';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

async function seedApp() {
  return svc.saveApp({ appId: 1001, slug: 'vocion-northwind', name: 'Vocion Northwind', clientId: 'Iv1.fixture', ownerLogin: 'northwind', htmlUrl: null, permissions: {}, events: [], secrets: { privateKey, webhookSecret: 'whsec', clientSecret: 'cs' } }, 'usr-owner');
}

async function openAsks() {
  return db.select().from(askSchema).where(eq(askSchema.orgId, ORG));
}

beforeEach(async () => {
  await db.delete(askSchema);
  await db.delete(githubInstallationSchema);
  await db.delete(githubAppSchema);
  svc.resetGithubAppCaches();
  vi.unstubAllGlobals();
});

describe('raising a connection request', () => {
  it('files one credential ask per account, however many repositories, and refreshes it when raised again', async () => {
    await seedApp();
    const first = await requests.raiseConnectionGaps({ orgId: ORG, provider: 'github', resources: ['Northwind/orders-api', 'Northwind/billing'], why: 'The factory builds here.' });
    const again = await requests.raiseConnectionGaps({ orgId: ORG, provider: 'github', resources: ['Northwind/orders-api'], why: 'Still needed.' });

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ account: 'northwind', connected: false, created: true, fixLabel: 'Install on GitHub', fixUrl: 'https://vocion.northwind.example/api/v1/connections/github/install' });
    expect(again[0]).toMatchObject({ askId: first[0]!.askId, created: false });

    const asks = await openAsks();

    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ kind: 'credential', status: 'open', sourceRef: 'connection:github:northwind', title: 'Connect GitHub for northwind', contextUrl: 'https://vocion.northwind.example/api/v1/connections/github/install' });
  });

  it('sends the person to create the app first when the deployment has none', async () => {
    const [gap] = await requests.raiseConnectionGaps({ orgId: ORG, provider: 'github', resources: ['Northwind/orders-api'], why: 'Needed.' });

    expect(gap).toMatchObject({ fixLabel: 'Create the GitHub App', fixUrl: 'https://vocion.northwind.example/dashboard/connectors' });
  });

  it('raises nothing for a repository an installation already covers', async () => {
    await seedApp();
    await db.insert(githubInstallationSchema).values({ orgId: ORG, appId: 1001, installationId: 555, accountLogin: 'Northwind', repositorySelection: 'all', repos: [] });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ token: 'ghs_fixture', expires_at: '2099-01-01T00:00:00Z' }), { status: 201 })));
    const [gap] = await requests.raiseConnectionGaps({ orgId: ORG, provider: 'github', resources: ['Northwind/orders-api'], why: 'Needed.' });

    expect(gap).toMatchObject({ connected: true, askId: null });
    expect(await openAsks()).toHaveLength(0);
  });

  it('names the request in the refusal of a call that had no access', async () => {
    await seedApp();
    const line = await requests.withConnectionRequest({ orgId: ORG, repo: 'Northwind/orders-api', kind: 'install', why: 'Reading CI.' });
    const [ask] = await openAsks();

    expect(line).toBe(` A connection request is waiting for an owner of northwind (ask #${ask!.id}): Install on GitHub at https://vocion.northwind.example/api/v1/connections/github/install.`);
  });
});

describe('closing a connection request', () => {
  it('closes as done, by the system, when the installation lands', async () => {
    await seedApp();
    await requests.raiseConnectionGaps({ orgId: ORG, provider: 'github', resources: ['Northwind/orders-api'], why: 'Needed.' });
    const [row] = await db.insert(githubInstallationSchema).values({ orgId: ORG, appId: 1001, installationId: 555, accountLogin: 'Northwind', repositorySelection: 'selected', repos: ['Northwind/orders-api'] }).returning();
    await svc.afterInstallationBound(row!);
    const [ask] = await openAsks();

    expect(ask).toMatchObject({ status: 'done', decidedBy: 'system:connections' });
    expect(ask!.decisionNote).toContain('Northwind/orders-api');
  });

  it('does not raise again what the person turned down, and raises afresh a gap that came back after it closed', async () => {
    await seedApp();
    const [gap] = await requests.raiseConnectionGaps({ orgId: ORG, provider: 'github', resources: ['Northwind/orders-api'], why: 'Needed.' });
    await decideAsk({ orgId: ORG, id: gap!.askId!, decision: 'reject', decidedBy: 'usr-owner' });
    const [declined] = await requests.raiseConnectionGaps({ orgId: ORG, provider: 'github', resources: ['Northwind/orders-api'], why: 'Needed again.' });

    expect(declined).toMatchObject({ declined: true, created: false });
    expect(await openAsks()).toHaveLength(1);

    await db.delete(askSchema);
    const [closed] = await requests.raiseConnectionGaps({ orgId: ORG, provider: 'github', resources: ['Northwind/orders-api'], why: 'Needed.' });
    await decideAsk({ orgId: ORG, id: closed!.askId!, decision: 'done', decidedBy: 'system:connections' });
    const [back] = await requests.raiseConnectionGaps({ orgId: ORG, provider: 'github', resources: ['Northwind/orders-api'], why: 'Gone again.' });

    expect(back).toMatchObject({ created: true });
    expect(back!.askId).not.toBe(closed!.askId);

    const [row] = await db.insert(githubInstallationSchema).values({ orgId: ORG, appId: 1001, installationId: 555, accountLogin: 'Northwind', repositorySelection: 'all', repos: [] }).returning();
    await svc.afterInstallationBound(row!);
    const reopened = (await openAsks()).find(a => a.id === back!.askId);

    expect(reopened?.status).toBe('done');
  });
});

describe('request_connection', () => {
  function ctx(events: unknown[], grant = true): RuntimeContext {
    return {
      orgId: ORG,
      userId: 'usr-owner',
      agentSlug: 'product-manager',
      conversationId: 412,
      connectorSources: [],
      objectTypeSlugs: [],
      enabledPlugins: ['software-factory'],
      searchConfig: {},
      harnessConfig: grant ? { grantTools: ['request_connection'] } : {},
      citationSeq: { current: 0 },
      delegations: new Map(),
      emit: (e: unknown) => events.push(e),
    } as unknown as RuntimeContext;
  }

  it('is only there for a seat granted it', () => {
    expect(buildDomainTools(ctx([], false)).some(t => t.name === 'request_connection')).toBe(false);
    expect(buildDomainTools(ctx([])).some(t => t.name === 'request_connection')).toBe(true);
  });

  it('puts up one card, already filed, whose link is the install screen', async () => {
    await seedApp();
    const events: Array<{ type: string; recommendation?: Record<string, unknown> }> = [];
    const tool = buildDomainTools(ctx(events)).find(t => t.name === 'request_connection')!;
    const answer = String(await tool.invoke({ provider: 'github', repos: ['Northwind/orders-api'], why: 'You asked to connect orders-api so the factory can build it.' }));

    const [ask] = await openAsks();

    expect(ask).toMatchObject({ kind: 'credential', status: 'open', agentSlug: 'product-manager', sourceRef: 'connection:github:northwind' });
    expect(answer).toContain(`ask #${ask!.id}`);
    expect(answer).toContain('closes by itself');

    const card = events.find(e => e.type === 'recommended_action')!.recommendation!;

    expect(card).toMatchObject({ actionId: 'ask.file', label: 'Connect GitHub for northwind', hrefLabel: 'Install on GitHub', href: 'https://vocion.northwind.example/api/v1/connections/github/install' });
    expect(typeof card.runId).toBe('number');
  });
});
