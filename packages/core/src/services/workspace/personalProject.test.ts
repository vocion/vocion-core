/**
 * Personal workspaces, against PGlite: one per person per account, and
 * invisible to everyone but their owner with workspace access enforced or
 * not.
 *
 * The refusals are the cases that matter. Each of them fails silently — no
 * error, a colleague simply sees a workspace holding somebody else's mail — so
 * every read path a person can reach is asked directly, under both settings of
 * `VOCION_ENFORCE_WORKSPACE_ACCESS`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { and, eq, sql } = await import('drizzle-orm');
const {
  accountMembershipSchema,
  conversationSchema,
  groupProjectGrantSchema,
  projectMemberSchema,
  projectSchema,
  tenantAccountSchema,
  userGroupMemberSchema,
  userGroupSchema,
  userSchema,
} = await import('@/models/Schema');
const { backfillPersonalProjects, ensurePersonalProject, ensurePersonalProjectsForUser, personalSlugCandidates } = await import('./personalProject');
const { actAs } = await import('./actAs');
const { accessibleProjects, resolveActiveWorkspace } = await import('@/services/WorkspaceAccessService');
const { listProjectsForUser, resolveProjectForUser } = await import('@/services/ProjectService');
const { createConversation, getConversation, listConversations } = await import('@/services/ConversationService');
const { projectSlugProblem } = await import('@/libs/links');

const NORTHWIND = 'acct-northwind-pp';
const KESTREL = 'acct-kestrel-pp';

const ALEX = 'usr-pp-alex'; // member of Northwind and Kestrel
const BRIT = 'usr-pp-brit'; // member of Northwind
const CASS = 'usr-pp-cass'; // admin of Northwind

const REVENUE = 'proj-pp-revenue'; // shared, Alex granted directly
const DELIVERY = 'proj-pp-delivery'; // shared, Alex holds no grant

async function reset() {
  await db.delete(conversationSchema);
  await db.delete(groupProjectGrantSchema);
  await db.delete(userGroupMemberSchema);
  await db.delete(userGroupSchema);
  await db.delete(projectMemberSchema);
  await db.delete(projectSchema);
  await db.delete(accountMembershipSchema);
  await db.delete(userSchema);
  await db.delete(tenantAccountSchema);
}

async function seed() {
  await db.insert(tenantAccountSchema).values([
    { id: NORTHWIND, name: 'Northwind', slug: 'northwind-pp' },
    { id: KESTREL, name: 'Kestrel Capital', slug: 'kestrel-pp' },
  ]);
  await db.insert(userSchema).values([
    { id: ALEX, email: 'alex@northwind.example' },
    { id: BRIT, email: 'brit@northwind.example' },
    { id: CASS, email: 'cass@northwind.example' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: NORTHWIND, userId: ALEX, role: 'member' },
    { accountId: NORTHWIND, userId: BRIT, role: 'member' },
    { accountId: NORTHWIND, userId: CASS, role: 'admin' },
    { accountId: KESTREL, userId: ALEX, role: 'member' },
  ]);
  // Shared workspaces made well before anyone's personal one, as on a live
  // deployment: the landing order is oldest first.
  const earlier = new Date('2026-01-01T00:00:00Z');
  await db.insert(projectSchema).values([
    { id: REVENUE, accountId: NORTHWIND, slug: 'revenue', name: 'Revenue Team', createdAt: earlier },
    { id: DELIVERY, accountId: NORTHWIND, slug: 'delivery', name: 'Delivery', createdAt: new Date('2026-01-02T00:00:00Z') },
  ]);
  await db.insert(projectMemberSchema).values({ projectId: REVENUE, userId: ALEX, role: 'member' });
}

const personalRows = (userId: string, accountId: string) => db
  .select()
  .from(projectSchema)
  .where(and(eq(projectSchema.ownerUserId, userId), eq(projectSchema.accountId, accountId), eq(projectSchema.kind, 'personal')));

beforeEach(async () => {
  await reset();
  await seed();
});

afterEach(() => {
  delete process.env.VOCION_ENFORCE_WORKSPACE_ACCESS;
});

describe('ensurePersonalProject', () => {
  it('creates a private, URL-safe workspace with an owner row', async () => {
    const p = await ensurePersonalProject(ALEX, NORTHWIND);
    const [row] = await db.select().from(projectSchema).where(eq(projectSchema.id, p.id));

    expect(row).toMatchObject({ kind: 'personal', ownerUserId: ALEX, accountId: NORTHWIND, name: 'Personal' });
    expect(projectSlugProblem(row!.slug)).toBeNull();
    // Derived from the id, never from a name or an email.
    expect(row!.slug).not.toContain('alex');

    const members = await db.select().from(projectMemberSchema).where(eq(projectMemberSchema.projectId, p.id));

    expect(members).toEqual([expect.objectContaining({ userId: ALEX, role: 'admin', source: 'owner' })]);
  });

  it('is idempotent', async () => {
    const first = await ensurePersonalProject(ALEX, NORTHWIND);
    const second = await ensurePersonalProject(ALEX, NORTHWIND);

    expect(second).toEqual(first);
    expect(await personalRows(ALEX, NORTHWIND)).toHaveLength(1);
  });

  it('creates exactly one per person per account under concurrent calls', async () => {
    const results = await Promise.all([
      ...Array.from({ length: 8 }, () => ensurePersonalProject(ALEX, NORTHWIND)),
      ...Array.from({ length: 8 }, () => ensurePersonalProject(ALEX, KESTREL)),
      ...Array.from({ length: 8 }, () => ensurePersonalProject(BRIT, NORTHWIND)),
    ]);

    expect(new Set(results.slice(0, 8).map(r => r.id)).size).toBe(1);
    expect(new Set(results.slice(8, 16).map(r => r.id)).size).toBe(1);
    expect(new Set(results.slice(16).map(r => r.id)).size).toBe(1);
    expect(await personalRows(ALEX, NORTHWIND)).toHaveLength(1);
    expect(await personalRows(ALEX, KESTREL)).toHaveLength(1);
    expect(await personalRows(BRIT, NORTHWIND)).toHaveLength(1);
  });

  it('is held to one per account by the database, not only by the code', async () => {
    await ensurePersonalProject(ALEX, NORTHWIND);

    await expect(db.insert(projectSchema).values({
      id: 'proj-pp-second',
      accountId: NORTHWIND,
      slug: 'another-personal',
      name: 'Personal',
      kind: 'personal',
      ownerUserId: ALEX,
    })).rejects.toThrow();
  });

  it('steps past a shared workspace that already holds its slug', async () => {
    const [taken] = personalSlugCandidates(ALEX);
    await db.insert(projectSchema).values({ id: 'proj-pp-squatter', accountId: NORTHWIND, slug: taken!, name: 'Squatter' });

    const p = await ensurePersonalProject(ALEX, NORTHWIND);

    expect(p.slug).not.toBe(taken);
    expect(await personalRows(ALEX, NORTHWIND)).toHaveLength(1);
  });

  it('covers every account at sign-in, and the backfill finds nothing left to do', async () => {
    const made = await ensurePersonalProjectsForUser(ALEX);

    expect(made.map(p => p.accountId).sort()).toEqual([KESTREL, NORTHWIND].sort());

    const backfill = await backfillPersonalProjects();

    // Alex is done; Brit and Cass are created now, and a second run is a no-op.
    expect(backfill).toEqual({ checked: 4, created: 2 });
    expect(await backfillPersonalProjects()).toEqual({ checked: 4, created: 0 });
  });
});

describe.each([
  ['off', undefined],
  ['on', '1'],
])('another person\'s personal workspace, enforcement %s', (_label, flag) => {
  let alexPersonal: string;
  let britPersonal: string;

  beforeEach(async () => {
    if (flag) {
      process.env.VOCION_ENFORCE_WORKSPACE_ACCESS = flag;
    }
    alexPersonal = (await ensurePersonalProject(ALEX, NORTHWIND)).id;
    britPersonal = (await ensurePersonalProject(BRIT, NORTHWIND)).id;
  });

  it('is not listed in the switcher', async () => {
    const ids = (await listProjectsForUser(ALEX)).map(p => p.id);

    expect(ids).toContain(alexPersonal);
    expect(ids).not.toContain(britPersonal);
    // Not for an account admin either.
    expect((await listProjectsForUser(CASS)).map(p => p.id)).not.toContain(britPersonal);
  });

  it('is not among the workspaces the person reaches', async () => {
    const ids = (await accessibleProjects(ALEX)).map(a => a.projectId);

    expect(ids).toContain(alexPersonal);
    expect(ids).not.toContain(britPersonal);
  });

  it('does not resolve by id or by slug — the same null as a workspace that does not exist', async () => {
    const [brit] = await db.select().from(projectSchema).where(eq(projectSchema.id, britPersonal));

    expect(await resolveProjectForUser(ALEX, { id: britPersonal })).toBeNull();
    expect(await resolveProjectForUser(ALEX, { slug: brit!.slug })).toBeNull();
    expect(await resolveProjectForUser(CASS, { slug: brit!.slug })).toBeNull();
    expect(await resolveProjectForUser(ALEX, { slug: 'no-such-workspace' })).toBeNull();
    // Its owner gets it.
    expect((await resolveProjectForUser(BRIT, { slug: brit!.slug }))?.id).toBe(britPersonal);
  });

  it('cannot be made the active workspace by naming it', async () => {
    const active = await resolveActiveWorkspace(ALEX, britPersonal);

    expect(active?.projectId).not.toBe(britPersonal);
    expect(active?.projectId).toBe(REVENUE);
    // Its owner can, and holds it as admin.
    expect(await resolveActiveWorkspace(BRIT, britPersonal)).toMatchObject({ projectId: britPersonal, workspaceRole: 'admin' });
  });

  it('is never the landing workspace for someone else', async () => {
    // Remove every shared workspace: the only thing left on the account is
    // two personal ones, and Alex must land on his own.
    await db.delete(projectSchema).where(eq(projectSchema.kind, 'shared'));

    expect((await resolveActiveWorkspace(ALEX))?.projectId).toBe(alexPersonal);
    expect((await resolveActiveWorkspace(CASS))?.projectId).not.toBe(alexPersonal);
    expect((await resolveActiveWorkspace(CASS))?.projectId).not.toBe(britPersonal);
  });

  it('is refused by actAs, and the owner is let in', async () => {
    expect(await actAs(ALEX, britPersonal)).toBeNull();
    expect(await actAs(CASS, britPersonal)).toBeNull();
    expect(await actAs(BRIT, britPersonal)).toEqual({ orgId: britPersonal, accountId: NORTHWIND, role: 'admin' });
  });

  it('keeps its conversations from everyone but its owner', async () => {
    const conv = await createConversation({ orgId: britPersonal, agentSlug: 'assistant', createdBy: BRIT });

    expect(await getConversation({ orgId: britPersonal, id: conv.id, viewerId: ALEX })).toBeNull();
    expect(await getConversation({ orgId: britPersonal, id: conv.id, viewerId: CASS })).toBeNull();
    expect(await listConversations({ orgId: britPersonal, viewerId: ALEX })).toEqual([]);
    expect(await listConversations({ orgId: britPersonal, agentSlug: 'assistant', viewerId: ALEX })).toEqual([]);

    expect((await getConversation({ orgId: britPersonal, id: conv.id, viewerId: BRIT }))?.id).toBe(conv.id);
    expect((await listConversations({ orgId: britPersonal, viewerId: BRIT })).map(c => c.id)).toEqual([conv.id]);
  });

  it('leaves conversations in a shared workspace readable by its members', async () => {
    const conv = await createConversation({ orgId: REVENUE, agentSlug: 'assistant', createdBy: BRIT });

    expect((await getConversation({ orgId: REVENUE, id: conv.id, viewerId: ALEX }))?.id).toBe(conv.id);
  });
});

describe('actAs on shared workspaces', () => {
  it('follows the account when enforcement is off', async () => {
    expect(await actAs(ALEX, REVENUE)).toEqual({ orgId: REVENUE, accountId: NORTHWIND, role: 'member' });
    expect(await actAs(ALEX, DELIVERY)).toEqual({ orgId: DELIVERY, accountId: NORTHWIND, role: 'member' });
  });

  it('follows grants when enforcement is on', async () => {
    process.env.VOCION_ENFORCE_WORKSPACE_ACCESS = '1';

    expect(await actAs(ALEX, REVENUE)).toEqual({ orgId: REVENUE, accountId: NORTHWIND, role: 'member' });
    expect(await actAs(ALEX, DELIVERY)).toBeNull();
    expect(await actAs(CASS, DELIVERY)).toEqual({ orgId: DELIVERY, accountId: NORTHWIND, role: 'admin' });
  });

  it('refuses a workspace on an account the person is not in, and one that does not exist', async () => {
    await db.insert(projectSchema).values({ id: 'proj-pp-kestrel', accountId: KESTREL, slug: 'deals', name: 'Deals' });

    expect(await actAs(BRIT, 'proj-pp-kestrel')).toBeNull();
    expect(await actAs(ALEX, 'proj-pp-missing')).toBeNull();
  });
});

describe('migration 0170, re-run against existing rows', () => {
  const MIGRATION = readFileSync(join(process.cwd(), 'migrations', '0170_personal_project_per_user.sql'), 'utf8');
  const indexExists = async () => {
    const result = await db.execute(sql`select 1 from pg_indexes where indexname = 'project_personal_owner_uq'`);
    return result.rows.length > 0;
  };

  afterEach(async () => {
    // Leave the index in place for every other file sharing this database.
    await db.delete(projectSchema).where(eq(projectSchema.kind, 'personal'));
    await db.execute(sql.raw(MIGRATION));
  });

  it('is a no-op when the index is already there', async () => {
    await db.execute(sql.raw(MIGRATION));

    expect(await indexExists()).toBe(true);
  });

  it('skips the build rather than failing the deploy over duplicates, and builds it once they are gone', async () => {
    await db.execute(sql`drop index if exists "project_personal_owner_uq"`);
    await db.insert(projectSchema).values([
      { id: 'proj-pp-dup-1', accountId: NORTHWIND, slug: 'dup-one', name: 'Personal', kind: 'personal', ownerUserId: ALEX },
      { id: 'proj-pp-dup-2', accountId: NORTHWIND, slug: 'dup-two', name: 'Personal', kind: 'personal', ownerUserId: ALEX },
    ]);

    await expect(db.execute(sql.raw(MIGRATION))).resolves.toBeDefined();
    expect(await indexExists()).toBe(false);
    // Still one answer for the person: the oldest.
    expect((await ensurePersonalProject(ALEX, NORTHWIND)).id).toMatch(/^proj-pp-dup-/);

    await db.delete(projectSchema).where(eq(projectSchema.id, 'proj-pp-dup-2'));
    await db.execute(sql.raw(MIGRATION));

    expect(await indexExists()).toBe(true);
  });
});
