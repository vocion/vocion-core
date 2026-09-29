import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { accountMembershipSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { accountsForUser, activeWorkspaceForUser, listProjectsForUser, projectSlugById, resolveProjectForUser } = await import('./ProjectService');

beforeEach(async () => {
  await db.delete(accountMembershipSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.delete(userSchema);

  await db.insert(userSchema).values([
    { id: 'user-chris', email: 'chris@example.com', name: 'Chris' },
    { id: 'user-outsider', email: 'outsider@example.com', name: 'Outsider' },
    { id: 'user-nobody', email: 'nobody@example.com', name: 'Nobody' },
  ]);
  await db.insert(tenantAccountSchema).values([
    { id: 'acct-metacto', name: 'Metacto', slug: 'metacto' },
    { id: 'acct-other', name: 'Other Co', slug: 'other-co' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: 'acct-metacto', userId: 'user-chris', role: 'admin' },
    { accountId: 'acct-other', userId: 'user-outsider', role: 'member' },
  ]);
  await db.insert(projectSchema).values([
    { id: 'proj-workforce', accountId: 'acct-metacto', slug: 'vocion-workforce', name: 'Vocion Workforce' },
    { id: 'proj-revenue', accountId: 'acct-metacto', slug: 'revenue-team', name: 'Revenue Team' },
    { id: 'proj-foreign', accountId: 'acct-other', slug: 'vocion-workforce', name: 'Same slug, other account' },
  ]);
});

describe('resolveProjectForUser', () => {
  it('finds a project on the member\'s own account by slug, case-insensitively', async () => {
    expect(await resolveProjectForUser('user-chris', { slug: 'vocion-workforce' })).toMatchObject({ id: 'proj-workforce', slug: 'vocion-workforce' });
    expect(await resolveProjectForUser('user-chris', { slug: 'Vocion-Workforce' })).toMatchObject({ id: 'proj-workforce' });
    expect(await resolveProjectForUser('user-chris', { slug: '  REVENUE-TEAM ' })).toMatchObject({ id: 'proj-revenue' });
  });

  it('finds a project by id the same way the switcher does', async () => {
    expect(await resolveProjectForUser('user-chris', { id: 'proj-revenue' })).toMatchObject({ slug: 'revenue-team' });
  });

  it('returns null for a non-member — the slug exists, on someone else\'s account', async () => {
    // `vocion-workforce` exists on BOTH accounts; the outsider only ever sees their own.
    expect(await resolveProjectForUser('user-outsider', { slug: 'vocion-workforce' })).toMatchObject({ id: 'proj-foreign' });
    expect(await resolveProjectForUser('user-outsider', { slug: 'revenue-team' })).toBeNull();
    expect(await resolveProjectForUser('user-outsider', { id: 'proj-revenue' })).toBeNull();
  });

  it('returns null for an unknown slug and for a user with no account', async () => {
    expect(await resolveProjectForUser('user-chris', { slug: 'does-not-exist' })).toBeNull();
    expect(await resolveProjectForUser('user-nobody', { slug: 'vocion-workforce' })).toBeNull();
    expect(await resolveProjectForUser('user-ghost', { slug: 'vocion-workforce' })).toBeNull();
  });
});

/**
 * Put Chris in both accounts. The Other Co row is first in the table, but
 * Chris joined Metacto earlier, so a read with no order returns Other Co
 * while tenancy picks Metacto.
 */
async function chrisInBothAccounts() {
  await db.delete(accountMembershipSchema).where(eq(accountMembershipSchema.userId, 'user-chris'));
  await db.insert(accountMembershipSchema).values([
    { accountId: 'acct-other', userId: 'user-chris', role: 'member', createdAt: new Date('2026-02-01T00:00:00Z') },
    { accountId: 'acct-metacto', userId: 'user-chris', role: 'admin', createdAt: new Date('2026-01-01T00:00:00Z') },
  ]);
}

// vocion-core#128: the workspace a person picks decides the account. Both
// accounts own a `vocion-workforce`, so a slug alone is ambiguous here.
describe('for a person in more than one account', () => {
  beforeEach(async () => {
    await chrisInBothAccounts();
  });

  it('lists the workspaces of every account they belong to, each tagged with its account', async () => {
    const projects = await listProjectsForUser('user-chris');

    expect(projects.map(p => [p.id, p.accountId]).sort()).toEqual([
      ['proj-foreign', 'acct-other'],
      ['proj-revenue', 'acct-metacto'],
      ['proj-workforce', 'acct-metacto'],
    ]);
  });

  it('lists their accounts oldest membership first, which is the order the switcher groups them in', async () => {
    expect((await accountsForUser('user-chris')).map(a => a.slug)).toEqual(['metacto', 'other-co']);
  });

  it('resolves a shared slug on the account they joined first when nothing else says otherwise', async () => {
    expect(await resolveProjectForUser('user-chris', { slug: 'vocion-workforce' })).toMatchObject({ id: 'proj-workforce' });
  });

  it('resolves a shared slug on the account of the workspace they were last in', async () => {
    const project = await resolveProjectForUser('user-chris', { slug: 'vocion-workforce' }, { lastActiveProjectId: 'proj-foreign' });

    expect(project).toMatchObject({ id: 'proj-foreign', accountId: 'acct-other' });
  });

  it('resolves a shared slug on the account a cross-account switch names, even against the last-active one', async () => {
    const project = await resolveProjectForUser('user-chris', { slug: 'vocion-workforce' }, { accountSlug: 'other-co', lastActiveProjectId: 'proj-revenue' });

    expect(project).toMatchObject({ id: 'proj-foreign' });
  });

  it('refuses a link naming an account they are not in, rather than opening their own same-named workspace', async () => {
    await db.insert(tenantAccountSchema).values({ id: 'acct-third', name: 'Third Co', slug: 'third-co' });
    await db.insert(projectSchema).values({ id: 'proj-third', accountId: 'acct-third', slug: 'vocion-workforce', name: 'Not theirs' });

    expect(await resolveProjectForUser('user-chris', { slug: 'vocion-workforce' }, { accountSlug: 'third-co' })).toBeNull();
  });

  it('finds a workspace by id on either account', async () => {
    expect(await resolveProjectForUser('user-chris', { id: 'proj-foreign' })).toMatchObject({ id: 'proj-foreign', accountId: 'acct-other' });
  });

  it('sends a bare /dashboard to the last-active workspace even when it is on their second account', async () => {
    expect(await activeWorkspaceForUser('user-chris', 'proj-foreign')).toEqual({ id: 'proj-foreign', accountId: 'acct-other', slug: 'vocion-workforce' });
  });

  it('ignores a last-active cookie naming another tenant\'s workspace and uses the account they joined first', async () => {
    await db.insert(tenantAccountSchema).values({ id: 'acct-third', name: 'Third Co', slug: 'third-co' });
    await db.insert(projectSchema).values({ id: 'proj-third', accountId: 'acct-third', slug: 'third', name: 'Not theirs' });

    const landing = await activeWorkspaceForUser('user-chris', 'proj-third');

    expect(landing?.accountId).toBe('acct-metacto');
  });
});

describe('listProjectsForUser / projectSlugById', () => {
  it('lists only the member\'s account and looks a slug up by id', async () => {
    expect((await listProjectsForUser('user-chris')).map(p => p.slug).sort()).toEqual(['revenue-team', 'vocion-workforce']);
    expect(await listProjectsForUser('user-nobody')).toEqual([]);
    expect(await projectSlugById('proj-revenue')).toBe('revenue-team');
    expect(await projectSlugById('proj-nope')).toBeNull();
  });
});
