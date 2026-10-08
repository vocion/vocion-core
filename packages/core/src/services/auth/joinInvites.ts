/**
 * Invites joined at sign-in, and telling the person what they joined.
 *
 * An invite to an address that already has a login used to wait for its link
 * to be opened. Now every completed sign-in — password, Google, Microsoft or
 * an email link, after the second factor when one is owed — accepts the
 * invites still open for the login's address (`completeSignIn` in
 * `libs/Auth.ts`). Which ones is `invitesToJoin`
 * (`services/auth/signInDecision.ts`), the same rule a first sign-in follows:
 * every Org that asked on a multi-Org server, the one this install allows on a
 * single-Org one. Each is accepted through `acceptInviteAsExistingUser`, the
 * invite link's own path, so the role, the personal workspace and the
 * single-Org refusal are exactly what clicking the link would have given.
 *
 * The address is the login's own, never one typed at sign-in: a login's email
 * is the address an admin invited (or an operator created), and it cannot be
 * changed from the profile, so an invite to it is an invite to this person.
 *
 * Each Org joined this way — and each joined by a first sign-in or an
 * auto-join domain — is told to the person as a notification in that Org's
 * workspace ("You joined Kestrel Capital", with the workspaces they now open),
 * through the event bus like every notification (`org-joined`,
 * `services/notifications/rules.ts`).
 *
 * Never throws: a sign-in must not fail because an invite could not be
 * accepted. An invite left behind keeps its link and is tried again next time.
 */

import { asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { accountMembershipSchema, inviteSchema, tenantAccountSchema, userSchema } from '@/models/Schema';
import { acceptInviteAsExistingUser } from '@/services/InviteAcceptance';
import { orgsMode } from '@/services/OrgPolicy';
import { invitesToJoin, usableInvites } from './signInDecision';

/** An Org a person was joined to, as the notification names it. */
export type JoinedOrg = { accountId: string; name: string };

function log(level: 'info' | 'warn' | 'error', message: string, properties: Record<string, unknown> = {}): void {
  import('@/libs/Logger')
    .then(({ logger }) => logger[level](message, properties))
    .catch(() => {});
}

/**
 * Every invite addressed to this email, in any state, with its Org.
 * @param email - Lowercased.
 */
export async function invitesFor(email: string) {
  return db
    .select({ token: inviteSchema.token, accountId: inviteSchema.accountId, email: inviteSchema.email, acceptedAt: inviteSchema.acceptedAt, expiresAt: inviteSchema.expiresAt })
    .from(inviteSchema)
    .where(sql`lower(${inviteSchema.email}) = ${email}`);
}

/**
 * The Orgs a login is in, oldest membership first.
 * @param userId - The person.
 */
export async function orgsOf(userId: string): Promise<string[]> {
  const rows = await db
    .select({ accountId: accountMembershipSchema.accountId })
    .from(accountMembershipSchema)
    .where(eq(accountMembershipSchema.userId, userId))
    .orderBy(asc(accountMembershipSchema.createdAt));
  return rows.map(r => r.accountId);
}

/**
 * Accept the invites still open for this login's address, and tell the
 * person which Orgs they joined. Never throws.
 * @param userId - The person who just signed in.
 * @param now - The current time; tests pass one.
 * @returns The Orgs joined, in the order they were accepted.
 */
export async function joinPendingInvites(userId: string, now: Date = new Date()): Promise<JoinedOrg[]> {
  try {
    const [user] = await db.select({ email: userSchema.email }).from(userSchema).where(eq(userSchema.id, userId)).limit(1);
    if (!user?.email) {
      return [];
    }
    const email = user.email.toLowerCase();
    const [invites, memberOf] = await Promise.all([invitesFor(email), orgsOf(userId)]);
    const joinable = invitesToJoin(invites, email, now, { mode: orgsMode(), memberOf });
    const joined: JoinedOrg[] = [];
    for (const invite of joinable) {
      const result = await acceptInviteAsExistingUser(userId, invite.token);
      if (!result.ok) {
        log('info', 'an invite was left for its link at sign-in', { status: result.status, error: result.error });
        continue;
      }
      joined.push({ accountId: result.accountId, name: await orgName(result.accountId) });
    }
    await tellJoined(userId, joined);
    return joined;
  } catch (error) {
    log('warn', 'joining pending invites at sign-in failed; their links still work', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/**
 * An Org's name, as a person reads it.
 * @param accountId - The Org.
 */
export async function orgName(accountId: string): Promise<string> {
  const [org] = await db.select({ name: tenantAccountSchema.name }).from(tenantAccountSchema).where(eq(tenantAccountSchema.id, accountId)).limit(1);
  return org?.name ?? 'an Org';
}

/**
 * The sentence a join notification carries: the workspaces the person now
 * opens there, by name. Pure.
 * @param workspaces - Their names, personal workspace included.
 */
export function joinedBody(workspaces: readonly string[]): string {
  if (workspaces.length === 0) {
    return 'An admin there gives you access to its workspaces.';
  }
  return `Your workspaces there: ${workspaces.join(', ')}.`;
}

/**
 * Tell a person, in each Org they just joined, that they joined it and which
 * workspaces they open there. The notification lands in that Org's first
 * workspace the person can open, so its link opens the Org. Never throws.
 * @param userId - The person.
 * @param joined - The Orgs joined.
 */
export async function tellJoined(userId: string, joined: readonly JoinedOrg[]): Promise<void> {
  if (joined.length === 0) {
    return;
  }
  try {
    const [{ activeWorkspaceForUser, listProjectsForUser }, { emitEvent }] = await Promise.all([
      import('@/services/ProjectService'),
      import('@/services/EventService'),
    ]);
    const projects = await listProjectsForUser(userId);
    for (const org of joined) {
      const landing = await activeWorkspaceForUser(userId, null, org.accountId);
      if (!landing || landing.accountId !== org.accountId) {
        continue;
      }
      const names = projects.filter(p => p.accountId === org.accountId).map(p => p.name);
      await emitEvent({
        orgId: landing.id,
        type: 'account.org_joined',
        payload: {
          userId,
          accountId: org.accountId,
          title: `You joined ${org.name}`,
          body: joinedBody(names),
          link: '/dashboard',
          dedupe: `${userId}:${org.accountId}`,
        },
        dedupeKey: `account.org_joined:${userId}:${org.accountId}`,
        dispatchMode: 'auto',
      });
    }
  } catch (error) {
    log('warn', 'could not tell a person which Orgs they joined', { error: error instanceof Error ? error.message : String(error) });
  }
}

/** An invite to this person's address that they have not joined, as their profile lists it. */
export type PendingInvitation = {
  /** The token their Join button accepts it with (`/api/invites/accept`). */
  token: string;
  orgName: string;
  role: 'admin' | 'member';
  expiresAt: Date;
  /** Why it cannot be joined here (a single-Org server and another Org), or null. */
  problem: string | null;
};

/**
 * The invites still open for this login's address, to Orgs the person is not
 * in — what their profile's "Invitations" lists, each with one Join. An
 * invite another Org sends between sign-ins waits here (and in its email) so
 * nobody has to sign out to accept it.
 * @param userId - The signed-in person.
 * @param now - The current time; tests pass one.
 */
export async function pendingInvitationsFor(userId: string, now: Date = new Date()): Promise<PendingInvitation[]> {
  const [user] = await db.select({ email: userSchema.email }).from(userSchema).where(eq(userSchema.id, userId)).limit(1);
  if (!user?.email) {
    return [];
  }
  const email = user.email.toLowerCase();
  const [invites, memberOf] = await Promise.all([invitesFor(email), orgsOf(userId)]);
  const open = usableInvites(invites, email, now).filter(i => !memberOf.includes(i.accountId));
  if (open.length === 0) {
    return [];
  }
  const { secondOrgProblem } = await import('@/services/OrgPolicy');
  const rows = await db
    .select({ token: inviteSchema.token, role: inviteSchema.role, orgName: tenantAccountSchema.name, accountId: inviteSchema.accountId })
    .from(inviteSchema)
    .innerJoin(tenantAccountSchema, eq(tenantAccountSchema.id, inviteSchema.accountId))
    .where(inArray(inviteSchema.token, open.map(i => i.token)));
  const byToken = new Map(rows.map(r => [r.token, r]));
  const out: PendingInvitation[] = [];
  for (const invite of open) {
    const row = byToken.get(invite.token);
    if (!row) {
      continue;
    }
    out.push({
      token: invite.token,
      orgName: row.orgName,
      role: row.role === 'admin' ? 'admin' : 'member',
      expiresAt: invite.expiresAt,
      problem: await secondOrgProblem(userId, invite.accountId),
    });
  }
  return out;
}

/**
 * Tell a person who already has a login that another Org invited them: a
 * notification in the workspace they use, opening their profile, where the
 * invite has a Join button. Their next sign-in would join it too. Nothing for
 * an address with no login (the invite email is how they hear). Never throws.
 * @param input - The invite.
 * @param input.email - The invited address.
 * @param input.accountId - The Org that invited them.
 * @param input.inviteId - The invite, for the dedupe.
 */
export async function tellInvitee(input: { email: string; accountId: string; inviteId: string }): Promise<void> {
  try {
    const [user] = await db.select({ id: userSchema.id }).from(userSchema).where(sql`lower(${userSchema.email}) = ${input.email.toLowerCase()}`).limit(1);
    if (!user) {
      return;
    }
    const [{ activeWorkspaceForUser }, { emitEvent }] = await Promise.all([
      import('@/services/ProjectService'),
      import('@/services/EventService'),
    ]);
    const landing = await activeWorkspaceForUser(user.id);
    if (!landing) {
      return;
    }
    const name = await orgName(input.accountId);
    await emitEvent({
      orgId: landing.id,
      type: 'account.org_invited',
      payload: {
        userId: user.id,
        accountId: input.accountId,
        title: `${name} invited you to join`,
        body: 'Join from your profile in one click — or sign in again, and it joins on its own.',
        link: '/dashboard/profile',
        dedupe: `${user.id}:${input.inviteId}`,
      },
      dedupeKey: `account.org_invited:${input.inviteId}`,
      dispatchMode: 'auto',
    });
  } catch (error) {
    log('warn', 'could not tell an invited login about its invite', { error: error instanceof Error ? error.message : String(error) });
  }
}
