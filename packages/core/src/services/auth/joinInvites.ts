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

import { asc, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { accountMembershipSchema, inviteSchema, tenantAccountSchema, userSchema } from '@/models/Schema';
import { acceptInviteAsExistingUser } from '@/services/InviteAcceptance';
import { orgsMode } from '@/services/OrgPolicy';
import { invitesToJoin } from './signInDecision';

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
