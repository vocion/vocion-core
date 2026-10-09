/**
 * MembersService — the PEOPLE in a tenant account. Not agent teams:
 * those are TeamService (the F1 `team` table / org chart). `listMembers`
 * here doubles as the accountable-user picker source for teams.
 *
 * Backs the /dashboard/members settings page: list members with roles,
 * change roles, remove members, and manage link-based invites.
 *
 * An invite is a LINK: `createInvite` returns a token the UI turns into a
 * `/sign-up?invite=<token>` URL, and that link is the invite whether or not
 * this server sends mail. With mail on, the router also mails it to the
 * address ("Join <Org> on Vocion", `services/InviteMail.ts`) and an admin can
 * resend it; with mail off, the admin copies the link and shares it
 * out-of-band (Slack, DM). The sign-up page reads `?invite=`: someone with
 * no login yet signs up there (`/api/signup` validates + consumes the row);
 * someone who already has a login — in another account, say — joins this
 * account on it (`/api/invites/accept`, `services/InviteAcceptance.ts`),
 * which adds a membership and never a second user (vocion-core#128), or is
 * joined at their next sign-in (`services/auth/joinInvites.ts`). So an
 * invite is refused only for an email already in THIS account.
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

/** Who sent an invite, as the members list names them. */
export type InviteSender = { userId: string; name: string | null; email: string };

export type PendingInvite = {
  id: string;
  email: string;
  role: string;
  token: string;
  expiresAt: Date;
  createdAt: Date | null;
  expired: boolean;
  /** The admin who sent it; null for an invite that names nobody (a seeded one). */
  invitedBy: InviteSender | null;
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
 * Open (unaccepted) invites, newest first, with who sent each one. Expired
 * ones are flagged, not hidden: the members list shows them as Expired with a
 * Re-invite, which is the one thing to do about them. A revoked invite is
 * deleted (`revokeInvite`), so there is no revoked state to filter out.
 *
 * Scoped to one account by `accountId`, which the caller takes from the
 * session and never from the request.
 * @param accountId - The session's account.
 */
export async function listPendingInvites(accountId: string): Promise<PendingInvite[]> {
  const rows = await db
    .select({
      invite: inviteSchema,
      inviterId: userSchema.id,
      inviterName: userSchema.name,
      inviterEmail: userSchema.email,
    })
    .from(inviteSchema)
    .leftJoin(userSchema, eq(inviteSchema.invitedBy, userSchema.id))
    .where(and(eq(inviteSchema.accountId, accountId), isNull(inviteSchema.acceptedAt)))
    .orderBy(desc(inviteSchema.createdAt));
  const now = new Date();
  return rows.map(({ invite: r, inviterId, inviterName, inviterEmail }) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    token: r.token,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    expired: r.expiresAt < now,
    invitedBy: inviterId ? { userId: inviterId, name: inviterName, email: inviterEmail ?? '' } : null,
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
    throw new Error(`${email} is already a member of this Org.`);
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
  const [sender] = await db
    .select({ userId: userSchema.id, name: userSchema.name, email: userSchema.email })
    .from(userSchema)
    .where(eq(userSchema.id, opts.invitedBy))
    .limit(1);
  return {
    id: row!.id,
    email: row!.email,
    role: row!.role,
    token: row!.token,
    expiresAt: row!.expiresAt,
    createdAt: row!.createdAt,
    expired: false,
    invitedBy: sender ? { ...sender, email: sender.email ?? '' } : null,
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
  // Their own connections (mail, calendar, Slack DMs …) leave with them: the
  // grants are withdrawn at each vendor and deleted, not left behind in a
  // personal workspace nobody can open any more.
  const { forgetPersonalConnections } = await import('@/services/personal/connections');
  await forgetPersonalConnections(opts.userId, opts.accountId);
}
