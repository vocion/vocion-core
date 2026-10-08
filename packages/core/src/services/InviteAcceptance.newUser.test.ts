/**
 * Creating a login by accepting an invite — the one shape every new login
 * takes, whether from the invite link's form or a first sign-in with Google,
 * Microsoft or an email link. Real rows in PGlite.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, inviteSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { acceptInviteAsNewUser } = await import('./InviteAcceptance');

const NOW = new Date();
const NEXT_WEEK = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);

beforeEach(async () => {
  await db.delete(inviteSchema);
  await db.delete(accountMembershipSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.delete(userSchema);
  await db.insert(tenantAccountSchema).values({ id: 'acct-northwind', name: 'Northwind', slug: 'northwind' });
  await db.insert(inviteSchema).values({ id: 'inv-dana', accountId: 'acct-northwind', email: 'Dana@Northwind.example', role: 'admin', token: 'tok-dana', expiresAt: NEXT_WEEK });
});

describe('acceptInviteAsNewUser', () => {
  it('makes the user, the membership with the invite\'s role, and spends the invite', async () => {
    const result = await acceptInviteAsNewUser({ inviteToken: 'tok-dana', email: 'DANA@northwind.example', name: ' Dana ', passwordHash: null }, NOW);

    expect(result).toMatchObject({ ok: true, accountId: 'acct-northwind' });

    const [dana] = await db.select().from(userSchema).where(eq(userSchema.email, 'dana@northwind.example'));

    expect(dana).toMatchObject({ name: 'Dana', passwordHash: null });
    expect(dana?.id).toMatch(/^usr-/);
    expect(await db.select({ role: accountMembershipSchema.role }).from(accountMembershipSchema).where(eq(accountMembershipSchema.userId, dana!.id))).toEqual([{ role: 'admin' }]);

    const [invite] = await db.select().from(inviteSchema);

    expect(invite?.acceptedAt).toBeInstanceOf(Date);
  });

  it('makes one user when the same invite is accepted twice at once', async () => {
    const both = await Promise.all([
      acceptInviteAsNewUser({ inviteToken: 'tok-dana', email: 'dana@northwind.example', name: null, passwordHash: 'hash' }, NOW),
      acceptInviteAsNewUser({ inviteToken: 'tok-dana', email: 'dana@northwind.example', name: null, passwordHash: 'hash' }, NOW),
    ]);

    expect(both.filter(r => r.ok)).toHaveLength(1);
    expect(await db.select().from(userSchema)).toHaveLength(1);
    expect(await db.select().from(accountMembershipSchema)).toHaveLength(1);
  });

  it('sends someone with a login to sign in instead', async () => {
    await db.insert(userSchema).values({ id: 'usr-dana', email: 'dana@northwind.example' });

    await expect(acceptInviteAsNewUser({ inviteToken: 'tok-dana', email: 'dana@northwind.example', name: null, passwordHash: null }, NOW))
      .resolves
      .toMatchObject({ ok: false, status: 409, code: 'EXISTING_USER' });
  });

  it('refuses an invite for another address, and makes nothing', async () => {
    await expect(acceptInviteAsNewUser({ inviteToken: 'tok-dana', email: 'mallory@acme.example', name: null, passwordHash: null }, NOW))
      .resolves
      .toMatchObject({ ok: false, status: 403 });
    expect(await db.select().from(userSchema)).toHaveLength(0);
  });
});
