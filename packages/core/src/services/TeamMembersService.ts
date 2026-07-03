/**
 * Team members — the PEOPLE in a tenant account (not agent teams).
 *
 * Backs the /dashboard/members settings page: list members with roles,
 * change roles, remove members, and manage link-based invites.
 *
 * Invites are LINK-based by design: no mailer is configured (Resend/SES
 * deferred per roadmap Phase 3), so `createInvite` returns a token the
 * UI turns into a `/sign-up?invite=<token>` URL for the admin to share
 * out-of-band (Slack, DM). The accept flow already exists: the sign-up
 * page reads `?invite=` and `/api/signup` validates + consumes the row.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { accountMembershipSchema, inviteSchema, userSchema } from '@/models/Schema';

const INVITE_TTL_DAYS = 14;

export type TeamMember = {
  userId: string;
  name: string | null;
  email: string;
  role: string;
  joinedAt: Date | null;
};

export type PendingInvite = {
  id: string;
  email: string;
  role: string;
  token: string;
  expiresAt: Date;
  createdAt: Date | null;
  expired: boolean;
};

export async function listMembers(accountId: string): Promise<TeamMember[]> {
  const rows = await db
    .select({
      userId: userSchema.id,
      name: userSchema.name,
      email: userSchema.email,
      role: accountMembershipSchema.role,
      joinedAt: accountMembershipSchema.createdAt,
    })
    .from(accountMembershipSchema)
    .innerJoin(userSchema, eq(accountMembershipSchema.userId, userSchema.id))
    .where(eq(accountMembershipSchema.accountId, accountId))
    .orderBy(accountMembershipSchema.createdAt);
  return rows.map(r => ({ ...r, email: r.email ?? '' }));
}

/**
 * Open (unaccepted) invites, newest first. Expired ones are flagged, not hidden.
 * @param accountId
 */
export async function listPendingInvites(accountId: string): Promise<PendingInvite[]> {
  const rows = await db
    .select()
    .from(inviteSchema)
    .where(and(eq(inviteSchema.accountId, accountId), isNull(inviteSchema.acceptedAt)))
    .orderBy(desc(inviteSchema.createdAt));
  const now = new Date();
  return rows.map(r => ({
    id: r.id,
    email: r.email,
    role: r.role,
    token: r.token,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    expired: r.expiresAt < now,
  }));
}

export async function createInvite(opts: {
  accountId: string;
  email: string;
  role: 'admin' | 'member';
  invitedBy: string;
}): Promise<PendingInvite> {
  const email = opts.email.trim().toLowerCase();

  const [existingUser] = await db
    .select({ userId: accountMembershipSchema.userId })
    .from(accountMembershipSchema)
    .innerJoin(userSchema, eq(accountMembershipSchema.userId, userSchema.id))
    .where(and(eq(accountMembershipSchema.accountId, opts.accountId), eq(userSchema.email, email)))
    .limit(1);
  if (existingUser) {
    throw new Error(`${email} is already a member of this account.`);
  }

  // One open invite per email: re-inviting refreshes the token + expiry
  // instead of piling up rows (each shared link would otherwise stay live).
  await db
    .delete(inviteSchema)
    .where(and(
      eq(inviteSchema.accountId, opts.accountId),
      eq(inviteSchema.email, email),
      isNull(inviteSchema.acceptedAt),
    ));

  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(inviteSchema)
    .values({
      id: `inv-${randomUUID()}`,
      accountId: opts.accountId,
      email,
      role: opts.role,
      token,
      invitedBy: opts.invitedBy,
      expiresAt,
    })
    .returning();
  return {
    id: row!.id,
    email: row!.email,
    role: row!.role,
    token: row!.token,
    expiresAt: row!.expiresAt,
    createdAt: row!.createdAt,
    expired: false,
  };
}

export async function revokeInvite(accountId: string, inviteId: string): Promise<void> {
  await db
    .delete(inviteSchema)
    .where(and(eq(inviteSchema.accountId, accountId), eq(inviteSchema.id, inviteId)));
}

async function assertNotLastAdmin(accountId: string, userId: string): Promise<void> {
  const admins = await db
    .select({ userId: accountMembershipSchema.userId })
    .from(accountMembershipSchema)
    .where(and(eq(accountMembershipSchema.accountId, accountId), eq(accountMembershipSchema.role, 'admin')));
  if (admins.length === 1 && admins[0]!.userId === userId) {
    throw new Error('This is the last admin — promote someone else first.');
  }
}

export async function changeMemberRole(opts: {
  accountId: string;
  userId: string;
  role: 'admin' | 'member';
}): Promise<void> {
  if (opts.role === 'member') {
    await assertNotLastAdmin(opts.accountId, opts.userId);
  }
  await db
    .update(accountMembershipSchema)
    .set({ role: opts.role })
    .where(and(
      eq(accountMembershipSchema.accountId, opts.accountId),
      eq(accountMembershipSchema.userId, opts.userId),
    ));
}

export async function removeMember(opts: { accountId: string; userId: string }): Promise<void> {
  await assertNotLastAdmin(opts.accountId, opts.userId);
  await db
    .delete(accountMembershipSchema)
    .where(and(
      eq(accountMembershipSchema.accountId, opts.accountId),
      eq(accountMembershipSchema.userId, opts.userId),
    ));
}
