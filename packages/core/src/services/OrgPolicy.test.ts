/**
 * Single-Org mode's two refusals (the default): no second Org on the server,
 * and no person in a second Org. Real rows in PGlite. Multi mode comes only
 * from an extension (mocked below; `libs/extensions.test.ts` covers core with
 * none).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Core alone never lifts the single-Org rule; an extension does. This one
// does it the conventional way, from VOCION_ORGS, so a test can flip it.
vi.mock('@vocion/enterprise/index', () => ({
  extensions: [{ name: 'test-orgs', orgs: { multiOrg: () => process.env.VOCION_ORGS === 'multi' } }],
}));
vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { newOrgProblem, orgsMode, secondOrgProblem } = await import('./OrgPolicy');

beforeEach(async () => {
  vi.unstubAllEnvs();
  await db.delete(accountMembershipSchema);
  await db.delete(tenantAccountSchema);
  await db.delete(userSchema);
  await db.insert(userSchema).values([{ id: 'user-sam', email: 'sam@example.com', name: 'Sam' }]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('orgsMode', () => {
  it('is single unless an extension lifts the rule', () => {
    vi.stubEnv('VOCION_ORGS', '');

    expect(orgsMode()).toBe('single');

    vi.stubEnv('VOCION_ORGS', 'multi');

    expect(orgsMode()).toBe('multi');

    vi.stubEnv('VOCION_ORGS', 'something-else');

    expect(orgsMode()).toBe('single');
  });
});

describe('newOrgProblem', () => {
  it('lets the first Org be created on an empty server', async () => {
    expect(await newOrgProblem()).toBeNull();
  });

  it('does not count an Org nobody belongs to, such as the migrations\' placeholder', async () => {
    await db.insert(tenantAccountSchema).values({ id: 'default-account', name: 'Default', slug: 'default' });

    expect(await newOrgProblem()).toBeNull();
  });

  it('refuses a second Org on a single-Org server, naming the one there', async () => {
    await db.insert(tenantAccountSchema).values({ id: 'acct-northwind', name: 'Northwind', slug: 'northwind' });
    await db.insert(accountMembershipSchema).values({ accountId: 'acct-northwind', userId: 'user-sam', role: 'admin' });

    expect(await newOrgProblem()).toMatch(/single Org \(Northwind\).*need an extension/);
  });

  it('never refuses on Vocion Cloud', async () => {
    vi.stubEnv('VOCION_ORGS', 'multi');
    await db.insert(tenantAccountSchema).values({ id: 'acct-northwind', name: 'Northwind', slug: 'northwind' });

    expect(await newOrgProblem()).toBeNull();
  });
});

describe('secondOrgProblem', () => {
  beforeEach(async () => {
    await db.insert(tenantAccountSchema).values([
      { id: 'acct-northwind', name: 'Northwind', slug: 'northwind' },
      { id: 'acct-kestrel', name: 'Kestrel Capital', slug: 'kestrel' },
    ]);
  });

  it('lets a person with no Org join one', async () => {
    expect(await secondOrgProblem('user-sam', 'acct-kestrel')).toBeNull();
  });

  it('lets a person rejoin the Org they are already in', async () => {
    await db.insert(accountMembershipSchema).values({ accountId: 'acct-northwind', userId: 'user-sam', role: 'member' });

    expect(await secondOrgProblem('user-sam', 'acct-northwind')).toBeNull();
  });

  it('refuses a second Org, in words the person can act on', async () => {
    await db.insert(accountMembershipSchema).values({ accountId: 'acct-northwind', userId: 'user-sam', role: 'member' });

    expect(await secondOrgProblem('user-sam', 'acct-kestrel')).toBe(
      'This Vocion server runs a single Org, and you already belong to Northwind, so you can\'t also join Kestrel Capital here. Ask an admin of Kestrel Capital to invite a different email.',
    );
  });

  it('never refuses on Vocion Cloud', async () => {
    vi.stubEnv('VOCION_ORGS', 'multi');
    await db.insert(accountMembershipSchema).values({ accountId: 'acct-northwind', userId: 'user-sam', role: 'member' });

    expect(await secondOrgProblem('user-sam', 'acct-kestrel')).toBeNull();
  });
});
