/**
 * Who an admin may invite (vocion-core#128): anyone not already in this
 * account, including someone who has a login in another account, since
 * accepting adds a membership to that login. Real rows in PGlite.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, inviteSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { createInvite } = await import('./MembersService');

beforeEach(async () => {
  await db.delete(inviteSchema);
  await db.delete(accountMembershipSchema);
  await db.delete(tenantAccountSchema);
  await db.delete(userSchema);

  await db.insert(userSchema).values([
    { id: 'user-kim', email: 'kim@example.com', name: 'Kim' },
    { id: 'user-sam', email: 'sam@example.com', name: 'Sam' },
  ]);
  await db.insert(tenantAccountSchema).values([
    { id: 'acct-contoso', name: 'Contoso', slug: 'contoso' },
    { id: 'acct-metacto', name: 'Metacto', slug: 'metacto' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: 'acct-contoso', userId: 'user-kim', role: 'admin' },
    { accountId: 'acct-metacto', userId: 'user-sam', role: 'admin' },
  ]);
});

describe('createInvite', () => {
  it('invites someone who already has a login in another account', async () => {
    const invite = await createInvite({ accountId: 'acct-contoso', email: 'Sam@Example.com', role: 'member', invitedBy: 'user-kim' });

    expect(invite).toMatchObject({ email: 'sam@example.com', role: 'member' });
    expect(await db.select().from(inviteSchema).where(eq(inviteSchema.accountId, 'acct-contoso'))).toHaveLength(1);
  });

  it('refuses someone already in this account', async () => {
    await expect(createInvite({ accountId: 'acct-contoso', email: 'kim@example.com', role: 'member', invitedBy: 'user-kim' }))
      .rejects
      .toThrow('kim@example.com is already a member of this Org.');
  });
});
