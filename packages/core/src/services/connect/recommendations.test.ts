/**
 * "Connect your systems" — the ranked list, against PGlite: each kind of
 * evidence moves a system up, the strongest first, and the Org evidence reads
 * only this workspace's own Org and only its shared workspaces.
 *
 * The apps, the live-connection check and the login apps are their own
 * modules' business (and tests); here they are inputs. The connector and
 * platform registries are the real ones, read only by slug.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const connectedByOrg = new Map<string, string[]>();
vi.mock('@/services/workspace/gettingStarted', () => ({
  connectedConnectors: vi.fn(async (orgId: string) => connectedByOrg.get(orgId) ?? []),
}));
let isAdmin = true;
vi.mock('./createSourceOnLogin', () => ({
  adminCheck: vi.fn(async () => (isAdmin ? null : 'Only a workspace admin can connect a source')),
}));
vi.mock('@/libs/connect/registry', () => ({
  connectOptionFor: vi.fn(async () => ({ provider: 'scripted', label: 'Vendor', configured: true, requiredEnv: [], bringYourOwnApp: false })),
}));
type Offer = { id: string; name: string; added: boolean; connectors: Array<{ slug: string; name: string; connected: boolean; needed: boolean }>; features: Array<{ slug: string; name: string }> };
let offers: Offer[] = [];
vi.mock('@/services/AppCatalogService', () => ({
  listAppOffers: vi.fn(async () => offers),
  getAppOffer: vi.fn(async (_org: string, id: string) => offers.find(o => o.id === id) ?? null),
}));
vi.mock('@/libs/workspace/plugins', () => ({
  listPlugins: vi.fn(() => [{ manifest: { slug: 'pipeline', setup: { connectors: ['hubspot'] }, recommend: { connectors: ['slack'] } } }]),
}));

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { recommendConnections, orgPeerConnectors, scoreOf, EVIDENCE_WEIGHT } = await import('./recommendations');

const NORTHWIND = 'acct-rc-northwind';
const KESTREL = 'acct-rc-kestrel';
const SALES = 'proj-rc-sales';
const SUPPORT = 'proj-rc-support';
const OPS = 'proj-rc-ops';
const DANA_OWN = 'proj-rc-dana';
const KESTREL_DEALS = 'proj-rc-kestrel';
const DANA = 'usr-rc-dana';

/** A resolver that says every domain's mail is hosted at the declared Google host. */
const mailAtSuite = async () => ['aspmx.l.google.com.'];
const noMail = async () => [];

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values([
    { id: NORTHWIND, name: 'Northwind', slug: 'northwind-rc' },
    { id: KESTREL, name: 'Kestrel Capital', slug: 'kestrel-rc' },
  ]);
  await db.insert(userSchema).values([{ id: DANA, email: 'dana@northwind-traders.org' }]);
  await db.insert(projectSchema).values([
    { id: SALES, accountId: NORTHWIND, slug: 'sales', name: 'Sales' },
    { id: SUPPORT, accountId: NORTHWIND, slug: 'support', name: 'Support' },
    { id: OPS, accountId: NORTHWIND, slug: 'ops', name: 'Ops' },
    { id: DANA_OWN, accountId: NORTHWIND, slug: 'dana', name: 'Dana', kind: 'personal', ownerUserId: DANA },
    { id: KESTREL_DEALS, accountId: KESTREL, slug: 'deals', name: 'Deals' },
  ]);
  await db.insert(knowledgeSourceSchema).values([
    // Two other shared workspaces of Northwind read Jira; one reads Notion.
    { orgId: SUPPORT, slug: 'jira', kind: 'jira' },
    { orgId: OPS, slug: 'jira-ops', kind: 'plugin', configJson: { _connector: 'jira' } },
    { orgId: OPS, slug: 'notion', kind: 'notion' },
    // Dana's own workspace and another Org: neither is evidence for Sales.
    { orgId: DANA_OWN, slug: 'github', kind: 'github' },
    { orgId: KESTREL_DEALS, slug: 'sentry', kind: 'sentry' },
  ]);
});

beforeEach(() => {
  isAdmin = true;
  connectedByOrg.clear();
  offers = [];
});

describe('the Org evidence', () => {
  it('counts only the other shared workspaces of the same Org', async () => {
    const peers = await orgPeerConnectors(SALES);

    expect(Object.fromEntries(peers)).toEqual({ jira: 2, notion: 1 });
  });

  it('never reads another Org, nor a person\'s own workspace', async () => {
    const peers = await orgPeerConnectors(SALES);

    expect(peers.has('sentry')).toBe(false);
    expect(peers.has('github')).toBe(false);
    expect(Object.fromEntries(await orgPeerConnectors(KESTREL_DEALS))).toEqual({});
  });
});

describe('ranking from evidence', () => {
  it('ranks what an added app needs, then mail, then the Org, when nobody scoped the plan', async () => {
    offers = [{ id: 'gtm', name: 'GTM', added: true, connectors: [{ slug: 'hubspot', name: 'HubSpot', connected: false, needed: true }], features: [{ slug: 'pipeline', name: 'Pipeline review' }] }];

    const plan = await recommendConnections({ orgId: SALES, userId: DANA }, {}, { resolveMx: mailAtSuite });
    const order = plan.question!.options;

    expect(order[0]).toBe('hubspot');
    expect(order.indexOf('gmail')).toBeGreaterThan(order.indexOf('hubspot'));
    expect(order.indexOf('jira')).toBeGreaterThan(order.indexOf('drive'));
    expect(plan.candidates.find(c => c.connector === 'hubspot')!.evidence).toEqual([{ kind: 'app', app: 'gtm', appName: 'GTM', needed: true }]);
  });

  it('walks only what the person named: evidence never adds a system to a plan they scoped', async () => {
    // Founder, 2026-10-09: "setup my software factory" walked GitHub, then
    // Gmail, Calendar and Drive on his mail host — and HubSpot, which an
    // added app needs — none of them the factory's.
    offers = [{ id: 'gtm', name: 'GTM', added: true, connectors: [{ slug: 'hubspot', name: 'HubSpot', connected: false, needed: true }], features: [{ slug: 'pipeline', name: 'Pipeline review' }] }];

    const plan = await recommendConnections({ orgId: SALES, userId: DANA }, { named: ['slack'] }, { resolveMx: mailAtSuite });

    expect(plan.candidates.map(c => c.connector)).toEqual(['slack']);
    // Named: the person said what they use, so there is nothing to ask.
    expect(plan.question).toBeNull();
  });

  it('reads the mail host from the registry\'s declaration, and only from it', async () => {
    const plan = await recommendConnections({ orgId: SALES, userId: DANA }, {}, { resolveMx: mailAtSuite });
    const mail = plan.candidates.filter(c => c.evidence.some(e => e.kind === 'mail')).map(c => c.connector);

    expect(mail).toEqual(['gmail', 'google-calendar', 'drive']);
    expect(plan.candidates.find(c => c.connector === 'gmail')!.recommended).toBe(true);

    const none = await recommendConnections({ orgId: SALES, userId: DANA }, {}, { resolveMx: noMail });

    expect(none.candidates.some(c => c.evidence.some(e => e.kind === 'mail'))).toBe(false);
  });

  it('asks one question when nothing was named, offering the ranked list with the evidence-backed ones recommended', async () => {
    const plan = await recommendConnections({ orgId: SALES, userId: DANA }, {}, { resolveMx: mailAtSuite });

    expect(plan.question?.question).toBe('Which of these do you use?');
    expect(plan.question!.options.slice(0, 3)).toEqual(['gmail', 'google-calendar', 'drive']);
    // Next, what the Org already uses: Jira in two workspaces before Notion in one.
    expect(plan.question!.options.slice(3, 5)).toEqual(['jira', 'notion']);
    expect(plan.candidates.find(c => c.connector === 'jira')!.evidence).toEqual([{ kind: 'org', workspaces: 2 }]);
    expect(plan.candidates.find(c => c.connector === 'jira')!.recommended).toBe(false);
    expect(plan.question!.options.length).toBeLessThanOrEqual(Math.max(8, plan.candidates.filter(c => c.recommended).length));
  });

  it('scopes to one app\'s systems with no question', async () => {
    offers = [{ id: 'gtm', name: 'GTM', added: false, connectors: [{ slug: 'hubspot', name: 'HubSpot', connected: false, needed: true }, { slug: 'slack', name: 'Slack', connected: false, needed: false }], features: [{ slug: 'pipeline', name: 'Pipeline review' }] }];

    const plan = await recommendConnections({ orgId: SALES, userId: DANA }, { app: 'gtm' }, { resolveMx: noMail });

    expect(plan.scope).toEqual({ app: 'gtm', appName: 'GTM' });
    expect(plan.candidates.map(c => c.connector)).toEqual(['hubspot', 'slack']);
    expect(plan.question).toBeNull();
    expect(plan.candidates[0]!.unlocks).toEqual([{ app: 'gtm', appName: 'GTM', href: '/dashboard/apps/gtm', added: false, features: ['Pipeline review'] }]);
  });

  it('leaves out what is already connected, and lists it as connected', async () => {
    connectedByOrg.set(SALES, ['slack']);

    const plan = await recommendConnections({ orgId: SALES, userId: DANA }, { named: ['slack', 'jira'] }, { resolveMx: noMail });

    expect(plan.candidates.map(c => c.connector)).toEqual(['jira']);
    expect(plan.connected).toEqual([{ connector: 'slack', name: 'Slack' }]);
  });

  it('ignores a named slug the registry does not have', async () => {
    const plan = await recommendConnections({ orgId: SALES, userId: DANA }, { named: ['not-a-connector'] }, { resolveMx: noMail });

    expect(plan.candidates.some(c => c.connector === 'not-a-connector')).toBe(false);
  });

  it('says why nothing can be connected for someone who is not an admin', async () => {
    isAdmin = false;

    const plan = await recommendConnections({ orgId: SALES, userId: DANA }, {}, { resolveMx: noMail });

    expect(plan.refused).toMatch(/admin/);
  });

  it('describes how each system connects from the registries, not from a list of vendors', async () => {
    const plan = await recommendConnections({ orgId: SALES, userId: DANA }, { named: ['slack', 'sentry'] }, { resolveMx: noMail });
    const slack = plan.candidates.find(c => c.connector === 'slack')!;
    const sentry = plan.candidates.find(c => c.connector === 'sentry')!;

    expect(slack.method.kind).toBe('login');
    expect(slack.method.kind === 'login' && slack.method.startHref).toMatch(/^\/api\/connect\/[a-z-]+\/start\?connector=slack&returnTo=%2Fdashboard%2Fconnect%2Fdone/);
    expect(sentry.method.kind === 'key' || sentry.method.kind === 'login').toBe(true);
  });
});

describe('scoreOf', () => {
  it('weighs named over an app\'s need over mail over the Org', () => {
    const named = scoreOf([{ kind: 'named' }]);
    const needed = scoreOf([{ kind: 'app', app: 'a', appName: 'A', needed: true }]);
    const mail = scoreOf([{ kind: 'mail', domain: 'northwind.example' }]);
    const org = scoreOf([{ kind: 'org', workspaces: 3 }]);

    expect(named).toBe(EVIDENCE_WEIGHT.named);
    expect(named).toBeGreaterThan(needed);
    expect(needed).toBeGreaterThan(mail);
    expect(mail).toBeGreaterThan(org);
  });
});
