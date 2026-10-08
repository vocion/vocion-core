/**
 * Google sign-in keeps the deployment invite-only: a verified Google email gets
 * in when it already has a login or a pending invite, and a user Google makes
 * joins the invited accounts the way the invite link would have joined them.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, inviteSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { acceptPendingInvitesForNewUser, googleSignInAllowed } = await import('./googleSignIn');

const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await db.delete(inviteSchema);
  await db.delete(accountMembershipSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.delete(userSchema);

  await db.insert(userSchema).values({ id: 'usr-sam', email: 'sam@northwind.example', name: 'Sam' });
  await db.insert(tenantAccountSchema).values([
    { id: 'acct-northwind', name: 'Northwind', slug: 'northwind' },
    { id: 'acct-contoso', name: 'Contoso Supply', slug: 'contoso' },
  ]);
  await db.insert(inviteSchema).values([
    { id: 'inv-open', accountId: 'acct-northwind', email: 'Lee@Northwind.example', role: 'member', token: 'tok-open', expiresAt: new Date(Date.now() + DAY) },
    { id: 'inv-open-2', accountId: 'acct-contoso', email: 'lee@northwind.example', role: 'admin', token: 'tok-open-2', expiresAt: new Date(Date.now() + DAY) },
    { id: 'inv-expired', accountId: 'acct-northwind', email: 'old@northwind.example', role: 'member', token: 'tok-expired', expiresAt: new Date(Date.now() - DAY) },
    { id: 'inv-used', accountId: 'acct-northwind', email: 'used@northwind.example', role: 'member', token: 'tok-used', expiresAt: new Date(Date.now() + DAY), acceptedAt: new Date() },
  ]);
});

describe('who Google may sign in', () => {
  it('lets in a verified email that already has a login', async () => {
    expect(await googleSignInAllowed({ email: 'Sam@Northwind.example', email_verified: true })).toBe(true);
  });

  it('lets in a verified email a pending invite names', async () => {
    expect(await googleSignInAllowed({ email: 'lee@northwind.example', email_verified: true })).toBe(true);
  });

  it('refuses an email Google has not verified, even one with a login', async () => {
    expect(await googleSignInAllowed({ email: 'sam@northwind.example', email_verified: false })).toBe(false);
    expect(await googleSignInAllowed({ email: 'sam@northwind.example' })).toBe(false);
  });

  it('refuses an email nobody invited — Google is not a sign-up', async () => {
    expect(await googleSignInAllowed({ email: 'stranger@acme.example', email_verified: true })).toBe(false);
  });

  it('refuses an email whose only invite expired or was already used', async () => {
    expect(await googleSignInAllowed({ email: 'old@northwind.example', email_verified: true })).toBe(false);
    expect(await googleSignInAllowed({ email: 'used@northwind.example', email_verified: true })).toBe(false);
  });

  it('refuses a profile with no email', async () => {
    expect(await googleSignInAllowed({ email_verified: true })).toBe(false);
    expect(await googleSignInAllowed(null)).toBe(false);
  });
});

describe('a user Google just made', () => {
  it('joins every account a pending invite to their email names, at the invite\'s role', async () => {
    await db.insert(userSchema).values({ id: 'usr-lee', email: 'lee@northwind.example', name: 'Lee' });

    expect(await acceptPendingInvitesForNewUser('usr-lee', 'lee@northwind.example')).toBe(2);

    const memberships = await db.select().from(accountMembershipSchema).where(eq(accountMembershipSchema.userId, 'usr-lee'));

    expect(memberships.map(m => [m.accountId, m.role]).sort()).toEqual([['acct-contoso', 'admin'], ['acct-northwind', 'member']]);

    const spent = await db.select().from(inviteSchema).where(eq(inviteSchema.email, 'lee@northwind.example'));

    expect(spent.every(invite => invite.acceptedAt)).toBe(true);
  });
});
