import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const people = vi.hoisted(() => new Map<string, Array<{ userId: string; email: string; name: string | null; role: 'admin' | 'member' }>>());
vi.mock('@/services/notifications/people', () => ({ workspacePeople: vi.fn(async (orgId: string) => people.get(orgId) ?? []) }));

const { db } = await import('@/libs/DB');
const { agentSchema, projectSchema, teamSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { eq } = await import('drizzle-orm');
const { decisionOwner, newOwnerCache } = await import('./owner');

const ORG = 'org_owner_a';
const OTHER = 'org_owner_b';

beforeEach(async () => {
  await db.delete(teamSchema);
  await db.delete(agentSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.delete(userSchema);
  await db.insert(userSchema).values([
    { id: 'usr-ada', email: 'ada@northwind.example' },
    { id: 'usr-ben', email: 'ben@northwind.example' },
    { id: 'usr-cy', email: 'cy@kestrel.example' },
  ]);
  await db.insert(tenantAccountSchema).values([{ id: 'acct-a', name: 'Northwind', slug: 'northwind' }, { id: 'acct-b', name: 'Kestrel Capital', slug: 'kestrel' }]);
  await db.insert(projectSchema).values([
    { id: ORG, accountId: 'acct-a', slug: 'ops', name: 'Ops', accountableUserId: 'usr-ada' },
    { id: OTHER, accountId: 'acct-b', slug: 'deals', name: 'Deals', accountableUserId: 'usr-cy' },
  ]);
  await db.insert(teamSchema).values({ orgId: ORG, slug: 'revenue', name: 'Revenue', accountableUserId: 'usr-ben' });
  await db.insert(agentSchema).values({ orgId: ORG, slug: 'deal-desk', name: 'Deal desk', systemPrompt: 'You run the desk.', teamSlug: 'revenue' } as never);
  people.set(ORG, [
    { userId: 'usr-ada', email: 'ada@northwind.example', name: null, role: 'admin' },
    { userId: 'usr-ben', email: 'ben@northwind.example', name: null, role: 'member' },
  ]);
  people.set(OTHER, [{ userId: 'usr-cy', email: 'cy@kestrel.example', name: null, role: 'admin' }]);
});

describe('decisionOwner', () => {
  it('is the asking team\'s accountable human — named on the ask, or found through the asking agent', async () => {
    expect(await decisionOwner(ORG, { teamSlug: 'revenue' })).toEqual({ userIds: ['usr-ben'], source: 'team' });
    expect(await decisionOwner(ORG, { agentSlug: 'deal-desk' })).toEqual({ userIds: ['usr-ben'], source: 'team' });
  });

  it('falls back to the workspace\'s accountable human, then its owner, then its admins', async () => {
    expect(await decisionOwner(ORG, { agentSlug: 'nobody-knows' })).toEqual({ userIds: ['usr-ada'], source: 'workspace' });

    await db.update(projectSchema).set({ accountableUserId: null, ownerUserId: 'usr-ben' }).where(eq(projectSchema.id, ORG));

    expect(await decisionOwner(ORG, {})).toEqual({ userIds: ['usr-ben'], source: 'owner' });

    await db.update(projectSchema).set({ ownerUserId: null }).where(eq(projectSchema.id, ORG));

    expect(await decisionOwner(ORG, {})).toEqual({ userIds: ['usr-ada'], source: 'admins' });
  });

  it('never tells someone who cannot open the workspace — a team owner from elsewhere is passed over', async () => {
    await db.update(teamSchema).set({ accountableUserId: 'usr-cy' }).where(eq(teamSchema.slug, 'revenue'));

    expect(await decisionOwner(ORG, { teamSlug: 'revenue' })).toEqual({ userIds: ['usr-ada'], source: 'workspace' });
    expect(await decisionOwner(OTHER, { teamSlug: 'revenue' })).toEqual({ userIds: ['usr-cy'], source: 'workspace' });
  });

  it('says so when there is nobody at all, and memoises per sweep', async () => {
    people.set(ORG, []);
    const cache = newOwnerCache();

    expect(await decisionOwner(ORG, {}, cache)).toEqual({ userIds: [], source: 'nobody' });

    people.set(ORG, [{ userId: 'usr-ada', email: 'ada@northwind.example', name: null, role: 'admin' }]);

    expect(await decisionOwner(ORG, {}, cache)).toEqual({ userIds: [], source: 'nobody' });
    expect(await decisionOwner(ORG, {})).toEqual({ userIds: ['usr-ada'], source: 'workspace' });
  });
});
