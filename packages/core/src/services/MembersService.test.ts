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
const { createInvite, listPendingInvites, revokeInvite } = await import('./MembersService');

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

describe('listPendingInvites', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('lists this account\'s open invites, newest first, with who sent each one', async () => {
    await db.insert(inviteSchema).values([
      { id: 'inv-old', accountId: 'acct-contoso', email: 'lee@contoso.example', role: 'admin', token: 'tok-old', invitedBy: 'user-kim', expiresAt: new Date(Date.now() + DAY), createdAt: new Date(Date.now() - 2 * DAY) },
      { id: 'inv-new', accountId: 'acct-contoso', email: 'max@contoso.example', role: 'member', token: 'tok-new', invitedBy: 'user-kim', expiresAt: new Date(Date.now() + 9 * DAY), createdAt: new Date(Date.now() - DAY) },
    ]);

    const invites = await listPendingInvites('acct-contoso');

    expect(invites.map(i => i.email)).toEqual(['max@contoso.example', 'lee@contoso.example']);
    expect(invites[0]).toMatchObject({
      role: 'member',
      token: 'tok-new',
      expired: false,
      invitedBy: { userId: 'user-kim', name: 'Kim', email: 'kim@example.com' },
    });
  });

  it('never shows another account\'s invites', async () => {
    await db.insert(inviteSchema).values([
      { id: 'inv-here', accountId: 'acct-contoso', email: 'lee@contoso.example', role: 'member', token: 'tok-here', invitedBy: 'user-kim', expiresAt: new Date(Date.now() + DAY) },
      { id: 'inv-there', accountId: 'acct-metacto', email: 'ola@acme.example', role: 'member', token: 'tok-there', invitedBy: 'user-sam', expiresAt: new Date(Date.now() + DAY) },
    ]);

    expect((await listPendingInvites('acct-contoso')).map(i => i.id)).toEqual(['inv-here']);
    expect((await listPendingInvites('acct-metacto')).map(i => i.id)).toEqual(['inv-there']);
  });

  it('leaves out an accepted invite, which is a person now, and flags an expired one', async () => {
    await db.insert(inviteSchema).values([
      { id: 'inv-taken', accountId: 'acct-contoso', email: 'lee@contoso.example', role: 'member', token: 'tok-taken', invitedBy: 'user-kim', expiresAt: new Date(Date.now() + DAY), acceptedAt: new Date() },
      { id: 'inv-lapsed', accountId: 'acct-contoso', email: 'max@contoso.example', role: 'member', token: 'tok-lapsed', invitedBy: null, expiresAt: new Date(Date.now() - DAY) },
    ]);

    const invites = await listPendingInvites('acct-contoso');

    expect(invites.map(i => i.id)).toEqual(['inv-lapsed']);
    expect(invites[0]).toMatchObject({ expired: true, invitedBy: null });
  });

  it('is empty once an invite is revoked, and revoking from another account does nothing', async () => {
    const invite = await createInvite({ accountId: 'acct-contoso', email: 'lee@contoso.example', role: 'member', invitedBy: 'user-kim' });

    expect(invite.invitedBy).toMatchObject({ userId: 'user-kim', name: 'Kim' });

    await revokeInvite('acct-metacto', invite.id);

    expect(await listPendingInvites('acct-contoso')).toHaveLength(1);

    await revokeInvite('acct-contoso', invite.id);

    expect(await listPendingInvites('acct-contoso')).toEqual([]);
  });

  it('re-inviting an address replaces its open invite rather than adding a second', async () => {
    const first = await createInvite({ accountId: 'acct-contoso', email: 'lee@contoso.example', role: 'member', invitedBy: 'user-kim' });
    const second = await createInvite({ accountId: 'acct-contoso', email: 'lee@contoso.example', role: 'member', invitedBy: 'user-kim' });

    const invites = await listPendingInvites('acct-contoso');

    expect(invites.map(i => i.id)).toEqual([second.id]);
    expect(second.token).not.toBe(first.token);
  });
});
