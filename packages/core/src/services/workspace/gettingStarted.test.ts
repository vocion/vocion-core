/**
 * Getting started, against PGlite: each of the five steps is read from what
 * is really in the workspace, and only from this workspace. A checklist that
 * ticked a step on a neighbour's connection, or on the lead core seeded, would
 * say "done" about work nobody did.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// Which sources a workspace has and whether each login is still live are their
// own modules' business (and tests); here they are the inputs.
const sourcesByOrg = new Map<string, Array<{ slug: string; kind: string | null; config: Record<string, unknown> }>>();
const live = new Set<string>();
vi.mock('@/services/SourceSyncService', () => ({
  listSources: vi.fn(async (orgId: string) => sourcesByOrg.get(orgId) ?? []),
}));
vi.mock('@/services/connect/createSourceOnLogin', () => ({
  connectorHasLiveSource: vi.fn(async (orgId: string, connector: string) => live.has(`${orgId}:${connector}`)),
}));

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, agentSchema, inviteSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { inArray } = await import('drizzle-orm');
const { gettingStartedFor } = await import('./gettingStarted');
const { WORKSPACE_LEAD_SLUG } = await import('@/libs/workspace/workspaceLead');

const NORTHWIND = 'acct-gs-northwind';
const KESTREL = 'acct-gs-kestrel';
const SUPPORT = 'proj-gs-support';
const NEIGHBOUR = 'proj-gs-kestrel';
const PERSONAL = 'proj-gs-personal';

function stepsOf(state: Awaited<ReturnType<typeof gettingStartedFor>>) {
  return Object.fromEntries((state?.steps ?? []).map(s => [s.id, s.done]));
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values([
    { id: NORTHWIND, name: 'Northwind', slug: 'northwind-gs' },
    { id: KESTREL, name: 'Kestrel Capital', slug: 'kestrel-gs' },
  ]);
  await db.insert(userSchema).values([
    { id: 'usr-gs-dana', email: 'dana@northwind.example' },
    { id: 'usr-gs-kai', email: 'kai@kestrel.example' },
    { id: 'usr-gs-lee', email: 'lee@kestrel.example' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: NORTHWIND, userId: 'usr-gs-dana', role: 'admin' },
    { accountId: KESTREL, userId: 'usr-gs-kai', role: 'admin' },
    { accountId: KESTREL, userId: 'usr-gs-lee', role: 'member' },
  ]);
});

beforeEach(async () => {
  sourcesByOrg.clear();
  live.clear();
  await db.update(tenantAccountSchema).set({ brand: null }).where(inArray(tenantAccountSchema.id, [NORTHWIND, KESTREL]));
  await db.delete(agentSchema);
  await db.delete(inviteSchema);
  await db.delete(projectSchema);
  await db.insert(projectSchema).values([
    { id: SUPPORT, accountId: NORTHWIND, slug: 'support', name: 'Northwind Support' },
    { id: NEIGHBOUR, accountId: KESTREL, slug: 'deals', name: 'Kestrel Deals', enabledPlugins: ['wiki'] },
    { id: PERSONAL, accountId: NORTHWIND, slug: 'dana', name: 'Dana', kind: 'personal' },
  ]);
  // The neighbour has done everything; none of it is ours.
  await db.insert(agentSchema).values({ orgId: NEIGHBOUR, projectId: NEIGHBOUR, slug: 'deal-analyst', name: 'Deal analyst', systemPrompt: 'x' });
  sourcesByOrg.set(NEIGHBOUR, [{ slug: 'github', kind: 'github', config: {} }]);
  live.add(`${NEIGHBOUR}:github`);
});

describe('gettingStartedFor', () => {
  it('a new workspace with only its seeded lead has done none of the five', async () => {
    await db.insert(agentSchema).values({ orgId: SUPPORT, projectId: SUPPORT, slug: WORKSPACE_LEAD_SLUG, name: 'Workspace lead', systemPrompt: 'x', role: 'lead' });
    const state = await gettingStartedFor(SUPPORT);

    expect(state).toMatchObject({ done: 0, total: 5 });
    expect(state?.steps.map(s => s.id)).toEqual(['connect', 'app', 'hire', 'invite', 'brand']);
  });

  it('"Make it yours" is done when the Org wears a brand — this Org\'s, never the neighbour\'s', async () => {
    await db.update(tenantAccountSchema).set({ brand: { name: 'Kestrel Capital' } }).where(eq(tenantAccountSchema.id, KESTREL));

    expect(stepsOf(await gettingStartedFor(NEIGHBOUR)).brand).toBe(true);
    expect(stepsOf(await gettingStartedFor(SUPPORT)).brand).toBe(false);

    await db.update(tenantAccountSchema).set({ brand: { name: 'Northwind' } }).where(eq(tenantAccountSchema.id, NORTHWIND));

    expect(stepsOf(await gettingStartedFor(SUPPORT)).brand).toBe(true);
  });

  it('counts each step from what is there', async () => {
    await db.update(projectSchema).set({ enabledPlugins: ['wiki'] }).where(eq(projectSchema.id, SUPPORT));
    await db.insert(agentSchema).values({ orgId: SUPPORT, projectId: SUPPORT, slug: 'reporting-analyst', name: 'Reporting analyst', systemPrompt: 'x' });
    sourcesByOrg.set(SUPPORT, [{ slug: 'eng-repos', kind: 'plugin', config: { _connector: 'github' } }]);
    live.add(`${SUPPORT}:github`);
    await db.insert(inviteSchema).values({ id: 'inv-gs-1', accountId: NORTHWIND, email: 'ana@northwind.example', role: 'member', token: 'tok-gs-1', expiresAt: new Date(Date.now() + 86_400_000) });

    const state = await gettingStartedFor(SUPPORT);

    expect(stepsOf(state)).toEqual({ connect: true, app: true, hire: true, invite: true, brand: false });
    expect(state?.done).toBe(4);
    expect(state?.detail.connected).toEqual(['github']);
  });

  it('a revoked login is not a connected system, a retired agent is not a hire, an expired invite is not an invite', async () => {
    sourcesByOrg.set(SUPPORT, [{ slug: 'github', kind: 'github', config: {} }]);
    await db.insert(agentSchema).values({ orgId: SUPPORT, projectId: SUPPORT, slug: 'reporting-analyst', name: 'Reporting analyst', systemPrompt: 'x', active: 'false' });
    await db.insert(inviteSchema).values({ id: 'inv-gs-2', accountId: NORTHWIND, email: 'ana@northwind.example', role: 'member', token: 'tok-gs-2', expiresAt: new Date(Date.now() - 1000) });

    expect(stepsOf(await gettingStartedFor(SUPPORT))).toEqual({ connect: false, app: false, hire: false, invite: false, brand: false });
  });

  it('a second member in the account is someone invited', async () => {
    expect(stepsOf(await gettingStartedFor(NEIGHBOUR)).invite).toBe(true);
    expect(stepsOf(await gettingStartedFor(SUPPORT)).invite).toBe(false);
  });

  it('is tenant-scoped: the neighbour\'s plugins, agents and connections tick nothing here', async () => {
    expect(stepsOf(await gettingStartedFor(NEIGHBOUR))).toMatchObject({ connect: true, app: true, hire: true });
    expect(stepsOf(await gettingStartedFor(SUPPORT))).toEqual({ connect: false, app: false, hire: false, invite: false, brand: false });
  });

  it('has nothing to say about a personal workspace, or one that does not exist', async () => {
    expect(await gettingStartedFor(PERSONAL)).toBeNull();
    expect(await gettingStartedFor('proj-gs-missing')).toBeNull();
  });
});
