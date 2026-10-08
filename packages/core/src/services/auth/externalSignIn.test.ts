/**
 * The invite-only gate against real rows (PGlite). Northwind invited Dana;
 * Kestrel Capital invited her too; Sam already has a login at Northwind.
 * A Google, Microsoft or email-link sign-in links, accepts or refuses — and
 * never makes a user without an invite.
 */
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, authAccountSchema, inviteSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { admitSignIn, refusalUrl } = await import('./externalSignIn');

const NOW = new Date();
const NEXT_WEEK = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
const LAST_WEEK = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);

function google(email: string, over: { sub?: string; name?: string | null; verified?: boolean } = {}) {
  return {
    method: 'oauth' as const,
    provider: 'google',
    providerAccountId: over.sub ?? `google-${email}`,
    identity: over.verified === false ? { ok: false as const, reason: 'unverified-email' as const } : { ok: true as const, email },
    name: over.name ?? null,
  };
}

async function usersWithEmail(email: string) {
  return db.select().from(userSchema).where(eq(userSchema.email, email));
}

beforeEach(async () => {
  await db.delete(authAccountSchema);
  await db.delete(inviteSchema);
  await db.delete(accountMembershipSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.delete(userSchema);

  await db.insert(tenantAccountSchema).values([
    { id: 'acct-northwind', name: 'Northwind', slug: 'northwind' },
    { id: 'acct-kestrel', name: 'Kestrel Capital', slug: 'kestrel' },
  ]);
  await db.insert(userSchema).values({ id: 'usr-sam', email: 'sam@northwind.example', name: 'Sam', passwordHash: 'hash' });
  await db.insert(accountMembershipSchema).values({ accountId: 'acct-northwind', userId: 'usr-sam', role: 'admin' });
});

describe('admitSignIn — an existing login', () => {
  it('lets a verified address with a login through, for Auth.js to link', async () => {
    await expect(admitSignIn(google('sam@northwind.example'), NOW)).resolves.toBe(true);
    // Nothing made here; the link itself is Auth.js's.
    expect(await usersWithEmail('sam@northwind.example')).toHaveLength(1);
  });

  it('signs in an already-linked account even when today\'s token is unverified', async () => {
    await db.insert(authAccountSchema).values({ userId: 'usr-sam', type: 'oidc', provider: 'google', providerAccountId: 'google-sam' });

    await expect(admitSignIn(google('sam@northwind.example', { sub: 'google-sam', verified: false }), NOW)).resolves.toBe(true);
  });

  it('refuses an unverified address even when it names a real login — no takeover', async () => {
    await expect(admitSignIn(google('sam@northwind.example', { verified: false }), NOW))
      .resolves
      .toBe(refusalUrl('unverified-email', 'google'));
  });
});

describe('admitSignIn — a pending invite', () => {
  it('creates the login exactly as the invite form does: user, membership with the invite\'s role, invite used, personal workspace', async () => {
    await db.insert(inviteSchema).values({ id: 'inv-1', accountId: 'acct-northwind', email: 'dana@northwind.example', role: 'member', token: 'tok-1', expiresAt: NEXT_WEEK });

    await expect(admitSignIn(google('dana@northwind.example', { name: 'Dana Reyes' }), NOW)).resolves.toBe(true);

    const [dana] = await usersWithEmail('dana@northwind.example');

    expect(dana).toMatchObject({ name: 'Dana Reyes', passwordHash: null });
    expect(dana?.id).toMatch(/^usr-/);

    const memberships = await db.select().from(accountMembershipSchema).where(eq(accountMembershipSchema.userId, dana!.id));

    expect(memberships.map(m => `${m.accountId}:${m.role}`)).toEqual(['acct-northwind:member']);

    const [used] = await db.select().from(inviteSchema).where(eq(inviteSchema.id, 'inv-1'));

    expect(used?.acceptedAt).toBeInstanceOf(Date);

    const personal = await db.select().from(projectSchema).where(and(eq(projectSchema.accountId, 'acct-northwind')));

    expect(personal.length).toBeGreaterThan(0);
  });

  it('accepts every pending invite to the address, one login with a membership per Org', async () => {
    await db.insert(inviteSchema).values([
      { id: 'inv-n', accountId: 'acct-northwind', email: 'dana@northwind.example', role: 'member', token: 'tok-n', expiresAt: NEXT_WEEK },
      { id: 'inv-k', accountId: 'acct-kestrel', email: 'Dana@Northwind.example', role: 'admin', token: 'tok-k', expiresAt: new Date(NEXT_WEEK.getTime() + 1000) },
    ]);

    await expect(admitSignIn({ method: 'email-link', email: 'dana@northwind.example' }, NOW)).resolves.toBe(true);

    const [dana] = await usersWithEmail('dana@northwind.example');
    const memberships = await db.select().from(accountMembershipSchema).where(eq(accountMembershipSchema.userId, dana!.id));

    expect(memberships.map(m => `${m.accountId}:${m.role}`).sort()).toEqual(['acct-kestrel:admin', 'acct-northwind:member']);
  });

  it('refuses, and makes nothing, when the only invite has expired or was used', async () => {
    await db.insert(inviteSchema).values([
      { id: 'inv-old', accountId: 'acct-northwind', email: 'dana@northwind.example', role: 'member', token: 'tok-old', expiresAt: LAST_WEEK },
      { id: 'inv-used', accountId: 'acct-kestrel', email: 'dana@northwind.example', role: 'member', token: 'tok-used', expiresAt: NEXT_WEEK, acceptedAt: LAST_WEEK },
    ]);

    await expect(admitSignIn(google('dana@northwind.example'), NOW)).resolves.toBe(refusalUrl('no-invite', 'google'));
    expect(await usersWithEmail('dana@northwind.example')).toHaveLength(0);
  });
});

describe('admitSignIn — nobody invited', () => {
  it('refuses with the sign-in page that says so, and never creates a user', async () => {
    const answer = await admitSignIn(google('mallory@acme.example'), NOW);

    expect(answer).toBe('/sign-in?error=AccessDenied&reason=no-invite&provider=google');
    expect(await usersWithEmail('mallory@acme.example')).toHaveLength(0);
  });

  it('refuses an email link for an address with no login and no invite', async () => {
    await expect(admitSignIn({ method: 'email-link', email: 'mallory@acme.example' }, NOW))
      .resolves
      .toBe('/sign-in?error=AccessDenied&reason=no-invite');
  });
});
