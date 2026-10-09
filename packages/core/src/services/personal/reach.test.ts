/**
 * One Personal per person, reading across their Orgs, against PGlite.
 *
 * Sam is in Northwind (home, joined first) and Contoso Supply; Kestrel Capital
 * keeps its items out of members' Personal. Each read is asked directly: what
 * reaches Personal with its content and Org label, what reaches it only as a
 * count with a link, what never reaches it, and that asks span the Orgs that
 * include themselves and refuse the one that does not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
const mode = vi.hoisted(() => ({ value: 'multi' as 'single' | 'multi' }));
vi.mock('@/services/OrgPolicy', () => ({ orgsMode: () => mode.value }));

const { db } = await import('@/libs/DB');
const { inArray } = await import('drizzle-orm');
const { accountMembershipSchema, askSchema, conversationSchema, personalRhythmSchema, projectMemberSchema, projectSchema, stateViewSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { ensurePersonalProject, findPersonalProject } = await import('@/services/workspace/personalProject');
const { listActingWorkspaces, resolveActingWorkspace } = await import('@/services/workspace/actingWorkspaces');
const { listInboxForUser } = await import('@/services/inbox/acrossWorkspaces');
const { listProjectsForUser } = await import('@/services/ProjectService');
const { personalReach, reachMode } = await import('./reach');
const { mergePersonalProjects } = await import('./merge');

const NORTHWIND = 'acct-reach-northwind';
const CONTOSO = 'acct-reach-contoso';
const KESTREL = 'acct-reach-kestrel';
const SAM = 'usr-reach-sam';
const FACTORY = 'proj-reach-factory';
const SUPPLY = 'proj-reach-supply';
const DEALS = 'proj-reach-deals';

async function ask(orgId: string, title: string) {
  await db.insert(askSchema).values({ orgId, kind: 'approval', title, status: 'open', createdBy: SAM });
}

beforeEach(async () => {
  mode.value = 'multi';
  const accounts = [NORTHWIND, CONTOSO, KESTREL];
  await db.delete(askSchema);
  await db.delete(conversationSchema);
  await db.delete(stateViewSchema);
  await db.delete(personalRhythmSchema);
  await db.delete(projectMemberSchema);
  await db.delete(projectSchema).where(inArray(projectSchema.accountId, accounts));
  await db.delete(accountMembershipSchema).where(inArray(accountMembershipSchema.accountId, accounts));
  await db.delete(userSchema).where(inArray(userSchema.id, [SAM]));
  await db.delete(tenantAccountSchema).where(inArray(tenantAccountSchema.id, accounts));

  await db.insert(tenantAccountSchema).values([
    { id: NORTHWIND, name: 'Northwind', slug: 'northwind-r' },
    { id: CONTOSO, name: 'Contoso Supply', slug: 'contoso-r' },
    { id: KESTREL, name: 'Kestrel Capital', slug: 'kestrel-r', includeInPersonal: false },
  ]);
  await db.insert(userSchema).values({ id: SAM, email: 'sam@northwind.example', name: 'Sam' });
  await db.insert(accountMembershipSchema).values([
    { accountId: NORTHWIND, userId: SAM, role: 'member', createdAt: new Date('2025-01-01T00:00:00Z') },
    { accountId: CONTOSO, userId: SAM, role: 'member', createdAt: new Date('2025-06-01T00:00:00Z') },
    { accountId: KESTREL, userId: SAM, role: 'member', createdAt: new Date('2026-01-01T00:00:00Z') },
  ]);
  await db.insert(projectSchema).values([
    { id: FACTORY, accountId: NORTHWIND, slug: 'factory', name: 'Factory' },
    { id: SUPPLY, accountId: CONTOSO, slug: 'supply', name: 'Supply Desk' },
    { id: DEALS, accountId: KESTREL, slug: 'deals', name: 'Deal Desk' },
  ]);
  await ask(FACTORY, 'Approve the Bellwater Hall launch');
  await ask(SUPPLY, 'Approve the Acme freight quote');
  await ask(DEALS, 'Sign the Larkfield term sheet');
});

describe('which Orgs a Personal reaches', () => {
  it('reads every Org in full, except one that opted out, and always the home Org', async () => {
    expect(reachMode({ home: true, includeInPersonal: false, multiOrg: true })).toBe('full');
    expect(reachMode({ home: false, includeInPersonal: false, multiOrg: false })).toBe('full');

    const reach = await personalReach(SAM);

    expect(reach.map(r => [r.name, r.mode, r.home])).toEqual([['Northwind', 'full', true], ['Contoso Supply', 'full', false], ['Kestrel Capital', 'counts', false]]);
  });

  it('is one Org, in full, on a single-Org install, as before', async () => {
    mode.value = 'single';
    await db.delete(accountMembershipSchema).where(inArray(accountMembershipSchema.accountId, [CONTOSO, KESTREL]));

    expect((await personalReach(SAM)).map(r => [r.name, r.mode])).toEqual([['Northwind', 'full']]);
  });
});

describe('waiting on me, from Personal', () => {
  it('carries content and the Org label from included Orgs, and only a count with a link from the one that opted out', async () => {
    const inbox = await listInboxForUser(SAM, { reach: await personalReach(SAM) });

    expect(inbox.items.map(i => [i.title, i.workspace.accountName]).sort()).toEqual([
      ['Approve the Acme freight quote', 'Contoso Supply'],
      ['Approve the Bellwater Hall launch', 'Northwind'],
    ]);
    // Kestrel's ask is counted, never read.
    expect(JSON.stringify(inbox.items)).not.toContain('Larkfield');
    expect(inbox.withheld).toEqual([expect.objectContaining({ accountName: 'Kestrel Capital', count: 1, workspace: { name: 'Deal Desk', slug: 'deals' } })]);
    expect(inbox.withheld[0]!.link).toMatch(/\/w\/deals\/dashboard\/inbox/);
    expect(inbox.workspaces.map(w => w.id)).not.toContain(DEALS);
  });
});

describe('asks from Personal', () => {
  it('reach the workspaces of every Org that includes itself, labelled with the Org', async () => {
    const list = await listActingWorkspaces(SAM);

    expect(list.map(w => [w.name, w.org.name])).toEqual([['Supply Desk', 'Contoso Supply'], ['Factory', 'Northwind']]);
    expect(await resolveActingWorkspace(SAM, null, 'supply')).toMatchObject({ identity: { orgId: SUPPLY, accountId: CONTOSO } });
  });

  it('never reach an Org that keeps its items out of Personal', async () => {
    expect(await resolveActingWorkspace(SAM, null, 'deals')).toBeNull();
  });
});

describe('one Personal per person', () => {
  it('lists only the one that stays until the old per-Org ones are folded', async () => {
    const home = await ensurePersonalProject(SAM, NORTHWIND);
    // A Personal on Contoso, as every Org made before.
    await db.insert(projectSchema).values({ id: 'proj-reach-old-personal', accountId: CONTOSO, slug: 'personal-old', name: 'Personal', kind: 'personal', ownerUserId: SAM });

    const personals = (await listProjectsForUser(SAM)).filter(p => p.kind === 'personal');

    expect(personals.map(p => p.id)).toEqual([home.id]);
  });

  it('folds the old ones in: a dry run that writes nothing, then once, then never again', async () => {
    const home = await ensurePersonalProject(SAM, NORTHWIND);
    await db.insert(projectSchema).values({ id: 'proj-reach-old-personal', accountId: CONTOSO, slug: 'personal-old', name: 'Personal', kind: 'personal', ownerUserId: SAM, createdAt: new Date('2024-01-01T00:00:00Z') });
    await db.insert(conversationSchema).values({ orgId: 'proj-reach-old-personal', projectId: 'proj-reach-old-personal', agentSlug: 'assistant', title: 'Plan the Acme visit', createdBy: SAM });
    await db.insert(stateViewSchema).values({ scope: 'person', orgId: 'proj-reach-old-personal', userId: SAM, slug: 'my-deals', name: 'My deals', description: 'Deals I own', query: { sets: ['crm.deal'] }, createdBy: SAM });
    await db.insert(personalRhythmSchema).values([{ userId: SAM, accountId: NORTHWIND }, { userId: SAM, accountId: CONTOSO }]);

    // The home Org's Personal stays even though the Contoso one is older.
    expect((await findPersonalProject(SAM))?.id).toBe(home.id);

    const dry = await mergePersonalProjects({ userId: SAM });

    expect(dry).toEqual([expect.objectContaining({ keep: { id: home.id, accountId: NORTHWIND }, rhythmsDropped: 1 })]);
    expect(dry[0]!.folds[0]!.counts).toMatchObject({ conversation: 1, state_view: 1 });
    expect(await db.select().from(conversationSchema).where(inArray(conversationSchema.orgId, ['proj-reach-old-personal']))).toHaveLength(1);

    await mergePersonalProjects({ userId: SAM, apply: true });

    const moved = await db.select().from(conversationSchema).where(inArray(conversationSchema.orgId, [home.id]));

    expect(moved.map(c => [c.title, c.projectId])).toEqual([['Plan the Acme visit', home.id]]);
    expect((await db.select().from(stateViewSchema).where(inArray(stateViewSchema.orgId, [home.id]))).map(v => v.slug)).toEqual(['my-deals']);
    expect((await db.select().from(personalRhythmSchema).where(inArray(personalRhythmSchema.userId, [SAM]))).map(r => r.accountId)).toEqual([NORTHWIND]);

    const [old] = await db.select().from(projectSchema).where(inArray(projectSchema.id, ['proj-reach-old-personal']));

    expect(old?.archivedAt).not.toBeNull();
    expect(await mergePersonalProjects({ userId: SAM, apply: true })).toEqual([]);
  });
});
