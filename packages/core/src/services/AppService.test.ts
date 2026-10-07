import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { appsForUser } = await import('./AppService');

// The rail's data comes from what each workspace the person can open has on —
// `enabled_plugins` and `enabled_surfaces` — read against the shipped apps.

beforeEach(async () => {
  await db.delete(accountMembershipSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.delete(userSchema);

  await db.insert(userSchema).values([
    { id: 'user-ada', email: 'ada@example.com', name: 'Ada' },
    { id: 'user-nobody', email: 'nobody@example.com', name: 'Nobody' },
  ]);
  await db.insert(tenantAccountSchema).values([
    { id: 'acct-northwind', name: 'Northwind', slug: 'northwind' },
    { id: 'acct-contoso', name: 'Contoso Supply', slug: 'contoso' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: 'acct-northwind', userId: 'user-ada', role: 'admin' },
  ]);
  await db.insert(projectSchema).values([
    { id: 'proj-build', accountId: 'acct-northwind', slug: 'build', name: 'Build', enabledPlugins: ['software-factory', 'wiki'] },
    { id: 'proj-sell', accountId: 'acct-northwind', slug: 'sell', name: 'Sell', enabledPlugins: [], enabledSurfaces: ['discovery'] },
    { id: 'proj-plain', accountId: 'acct-northwind', slug: 'plain', name: 'Plain' },
    // On an account Ada is not in: never in any picker of hers.
    { id: 'proj-foreign', accountId: 'acct-contoso', slug: 'foreign', name: 'Foreign', enabledPlugins: ['software-factory'] },
  ]);
});

describe('appsForUser', () => {
  it('lists every workspace under Workforce and only the ones with an app under that app', async () => {
    const r = await appsForUser('user-ada');
    const slugs = (id: string) => (r.workspacesByApp[id] ?? []).map(w => w.slug).sort();

    expect(r.apps.map(a => a.id)).toEqual(['workforce', 'software-factory', 'gtm']);
    expect(slugs('workforce')).toEqual(['build', 'plain', 'sell']);
    expect(slugs('software-factory')).toEqual(['build']);
    expect(slugs('gtm')).toEqual(['sell']);
    expect(r.workspacesByApp['software-factory']).toEqual([{ projectId: 'proj-build', slug: 'build', name: 'Build' }]);
  });

  it('gives a person with no workspace the core app and nothing else', async () => {
    expect(await appsForUser('user-nobody')).toEqual({ apps: [expect.objectContaining({ id: 'workforce', core: true })], workspacesByApp: { workforce: [] } });
  });
});
