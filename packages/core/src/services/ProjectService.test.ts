import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { listProjectsForUser, projectSlugById, resolveProjectForUser } = await import('./ProjectService');

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

describe('listProjectsForUser / projectSlugById', () => {
  it('lists only the member\'s account and looks a slug up by id', async () => {
    expect((await listProjectsForUser('user-chris')).map(p => p.slug).sort()).toEqual(['revenue-team', 'vocion-workforce']);
    expect(await listProjectsForUser('user-nobody')).toEqual([]);
    expect(await projectSlugById('proj-revenue')).toBe('revenue-team');
    expect(await projectSlugById('proj-nope')).toBeNull();
  });
});
