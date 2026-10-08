/**
 * Auto-join domains (real rows, PGlite): the one way in without an invite,
 * and only where the operator listed the domain on a single-Org install.
 *
 * Pinned: how `VOCION_AUTO_JOIN_DOMAINS` is read; that the policy is off
 * when unset, on a multi-Org server, and before anyone belongs to an Org; that
 * a login made this way is a member of the install's Org with a verified
 * address; and, through the sign-in gate, that a verified Google address in a
 * listed domain gets in while an unlisted domain, or a multi-Org server, is
 * refused with "no invite".
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// The Org rule reads the extension seam; a test flips it to multi-Org.
const orgs = vi.hoisted(() => ({ multi: false }));
vi.mock('@vocion/enterprise/index', () => ({
  extensions: [{ name: 'test-orgs', orgs: { multiOrg: () => orgs.multi } }],
}));

const { db } = await import('@/libs/DB');
const schema = await import('@/models/Schema');
const { autoJoinDomains, autoJoinPolicy, joinByDomain } = await import('./autoJoin');
const { admitSignIn, refusalUrl } = await import('./externalSignIn');

function google(email: string) {
  return {
    method: 'oauth' as const,
    provider: 'google',
    providerAccountId: `google-${email}`,
    identity: { ok: true as const, email },
    name: 'Ana Ortiz',
  };
}

async function loginsFor(email: string) {
  return db.select().from(schema.userSchema).where(eq(schema.userSchema.email, email));
}

async function membershipsOf(userId: string) {
  const rows = await db.select().from(schema.accountMembershipSchema).where(eq(schema.accountMembershipSchema.userId, userId));
  return rows.map(r => `${r.accountId}:${r.role}`);
}

beforeEach(async () => {
  orgs.multi = false;
  vi.stubEnv('VOCION_AUTO_JOIN_DOMAINS', '');
  await db.delete(schema.inviteSchema);
  await db.delete(schema.authAccountSchema);
  await db.delete(schema.accountMembershipSchema);
  await db.delete(schema.projectSchema);
  await db.delete(schema.tenantAccountSchema);
  await db.delete(schema.userSchema);
  // The empty Default every database starts with, and the install's real Org.
  await db.insert(schema.tenantAccountSchema).values([
    { id: 'acct-default', name: 'Default', slug: 'default' },
    { id: 'acct-northwind', name: 'Northwind', slug: 'northwind' },
  ]);
  await db.insert(schema.userSchema).values({ id: 'usr-sam', email: 'sam@northwind.example', name: 'Sam', passwordHash: 'hash' });
  await db.insert(schema.accountMembershipSchema).values({ accountId: 'acct-northwind', userId: 'usr-sam', role: 'admin' });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('autoJoinDomains', () => {
  it('reads a comma list: trimmed, lowercased, without @, duplicates or junk', () => {
    expect(autoJoinDomains(' Northwind.example, @northwind-labs.example ,northwind.example,, not a domain, localhost, a@b.example ')).toEqual(['northwind.example', 'northwind-labs.example']);
  });

  it('is empty when unset or blank', () => {
    expect(autoJoinDomains(undefined)).toEqual([]);
    expect(autoJoinDomains('')).toEqual([]);
    expect(autoJoinDomains(' , ')).toEqual([]);
  });
});

describe('autoJoinPolicy', () => {
  it('is off when the setting is unset', async () => {
    await expect(autoJoinPolicy()).resolves.toBeNull();
  });

  it('names the Org people belong to — never the empty Default', async () => {
    vi.stubEnv('VOCION_AUTO_JOIN_DOMAINS', 'northwind.example');

    await expect(autoJoinPolicy()).resolves.toEqual({ domains: ['northwind.example'], accountId: 'acct-northwind' });
  });

  it('is off before anyone belongs to an Org: the first admin is made on the instance', async () => {
    vi.stubEnv('VOCION_AUTO_JOIN_DOMAINS', 'northwind.example');
    await db.delete(schema.accountMembershipSchema);

    await expect(autoJoinPolicy()).resolves.toBeNull();
  });

  it('is off on a multi-Org server, where a domain is each Org\'s own claim', async () => {
    vi.stubEnv('VOCION_AUTO_JOIN_DOMAINS', 'northwind.example');
    orgs.multi = true;

    await expect(autoJoinPolicy()).resolves.toBeNull();
  });
});

describe('joinByDomain', () => {
  it('makes a usr- login, a member of the install\'s Org, with its address marked verified', async () => {
    const result = await joinByDomain({ email: 'ana@northwind.example', name: ' Ana Ortiz ', accountId: 'acct-northwind', domain: 'northwind.example' });

    expect(result).toMatchObject({ ok: true, accountId: 'acct-northwind' });

    const [ana] = await loginsFor('ana@northwind.example');

    expect(ana?.id).toMatch(/^usr-/);
    expect(ana).toMatchObject({ name: 'Ana Ortiz', passwordHash: null });
    expect(ana?.emailVerified).toBeInstanceOf(Date);
    expect(await membershipsOf(ana!.id)).toEqual(['acct-northwind:member']);
  });

  it('makes nothing when the address already has a login', async () => {
    await expect(joinByDomain({ email: 'sam@northwind.example', name: null, accountId: 'acct-northwind', domain: 'northwind.example' }))
      .resolves
      .toEqual({ ok: false, reason: 'exists' });
    expect(await loginsFor('sam@northwind.example')).toHaveLength(1);
    expect(await membershipsOf('usr-sam')).toEqual(['acct-northwind:admin']);
  });

  it('makes nothing for an Org that is gone, or on a multi-Org server', async () => {
    await expect(joinByDomain({ email: 'ana@northwind.example', name: null, accountId: 'acct-gone', domain: 'northwind.example' })).resolves.toEqual({ ok: false, reason: 'no-org' });

    orgs.multi = true;

    await expect(joinByDomain({ email: 'ana@northwind.example', name: null, accountId: 'acct-northwind', domain: 'northwind.example' })).resolves.toEqual({ ok: false, reason: 'no-org' });
    expect(await loginsFor('ana@northwind.example')).toHaveLength(0);
  });
});

describe('through the sign-in gate', () => {
  beforeEach(() => {
    vi.stubEnv('VOCION_AUTO_JOIN_DOMAINS', 'northwind.example');
  });

  it('lets a verified address in a listed domain in as a member, with no invite', async () => {
    await expect(admitSignIn(google('ana@northwind.example'))).resolves.toBe(true);

    const [ana] = await loginsFor('ana@northwind.example');

    expect(await membershipsOf(ana!.id)).toEqual(['acct-northwind:member']);
  });

  it('refuses an address in a domain nobody listed', async () => {
    await expect(admitSignIn(google('ana@kestrel.example'))).resolves.toBe(refusalUrl('no-invite', 'google'));
    expect(await loginsFor('ana@kestrel.example')).toHaveLength(0);
  });

  it('refuses on a multi-Org server, whatever the setting says', async () => {
    orgs.multi = true;

    await expect(admitSignIn(google('ana@northwind.example'))).resolves.toBe(refusalUrl('no-invite', 'google'));
    expect(await loginsFor('ana@northwind.example')).toHaveLength(0);
  });
});
