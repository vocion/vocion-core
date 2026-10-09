/**
 * Accepting an invite as someone who already has a login (vocion-core#128).
 *
 * People call a tenant an Org; the rows are `tenant_account` and
 * `account_membership`, so identifiers here still say "account".
 *
 * One person is one `user` row, with one `account_membership` row per Org
 * they belong to — on Vocion Cloud (`VOCION_ORGS=multi`). A single-Org server
 * refuses the invite that would put someone in a second Org
 * (`services/OrgPolicy.ts`). An invite used to be accepted only by creating a new user
 * (`/api/signup`), which refused an email that already had one, so nobody
 * could ever join a second account. Now a signed-in person whose email matches
 * the invite joins that account on their existing user: one more membership
 * row, the same login, the same session. The invite's role lands on that
 * membership, so each account decides independently what the person may do
 * there.
 *
 * Plain functions, so the route (`/api/invites/accept`), the sign-up page and
 * the tests all call the same rules.
 */

import { randomUUID } from 'node:crypto';
import { and, eq, isNull, TransactionRollbackError } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { workspaceUrl } from '@/libs/links';
import { accountMembershipSchema, inviteSchema, tenantAccountSchema, userSchema } from '@/models/Schema';
import { inviteProblem } from '@/services/inviteRules';
import { secondOrgProblem } from '@/services/OrgPolicy';
import { activeWorkspaceForUser } from '@/services/ProjectService';
import { ensurePersonalProjectsForUser } from '@/services/workspace/personalProject';

/**
 * Where a signed-in person stands with an invite link, in the order the page
 * explains it: "already in this account" beats "already used", because the
 * usual reason an invite is used is that this person used it.
 */
export type InviteStanding = 'member' | 'accepted' | 'expired' | 'other-email' | 'open';

/** What the sign-up page shows a signed-in person about an invite link. */
export type InviteSummary = {
  accountName: string;
  role: 'admin' | 'member';
  standing: InviteStanding;
  /**
   * Where to open that account, when they are already in it and hold a
   * workspace there; null otherwise.
   */
  openPath: string | null;
};

export type AcceptInviteResult
  /** `openPath` is null when they joined but can open no workspace there yet. */
  = | { ok: true; accountId: string; openPath: string | null }
    | { ok: false; status: 403 | 404 | 409 | 410; error: string };

/**
 * The invite a token names, with its account's name and slug.
 * @param token - The invite token from the link.
 * @returns The invite, or undefined when the token matches none.
 */
async function inviteByToken(token: string) {
  const [invite] = await db
    .select({
      id: inviteSchema.id,
      accountId: inviteSchema.accountId,
      accountName: tenantAccountSchema.name,
      accountSlug: tenantAccountSchema.slug,
      email: inviteSchema.email,
      role: inviteSchema.role,
      acceptedAt: inviteSchema.acceptedAt,
      expiresAt: inviteSchema.expiresAt,
    })
    .from(inviteSchema)
    .innerJoin(tenantAccountSchema, eq(tenantAccountSchema.id, inviteSchema.accountId))
    .where(eq(inviteSchema.token, token))
    .limit(1);
  return invite;
}

/**
 * The email a person signs in with.
 * @param userId - The person.
 * @returns The email, or null when the user is gone or has none.
 */
async function emailOf(userId: string): Promise<string | null> {
  const [user] = await db.select({ email: userSchema.email }).from(userSchema).where(eq(userSchema.id, userId)).limit(1);
  return user?.email ?? null;
}

/**
 * Whether this person already has a membership on the account.
 * @param userId - The person.
 * @param accountId - The account.
 */
async function isMemberOf(userId: string, accountId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: accountMembershipSchema.userId })
    .from(accountMembershipSchema)
    .where(and(eq(accountMembershipSchema.accountId, accountId), eq(accountMembershipSchema.userId, userId)))
    .limit(1);
  return Boolean(row);
}

/**
 * The first workspace this person can open in one Org, as a URL that
 * names the Org with `?org=` so a slug shared with one of their other
 * Orgs resolves there. With access enforced, a new member may hold nothing
 * there yet: then their one Personal, named on its own Org (naming this Org
 * on a workspace from another would 404).
 * @param userId - The person.
 * @param accountId - The account to open.
 * @param accountSlug - Its slug, for `?org=`.
 * @returns The URL, or null when they can open nothing there yet.
 */
async function openPathOnAccount(userId: string, accountId: string, accountSlug: string): Promise<string | null> {
  const landing = await activeWorkspaceForUser(userId, null, accountId);
  if (landing?.accountId === accountId) {
    return workspaceUrl(landing.slug, '/dashboard', { accountSlug });
  }
  // Nothing there yet: their one Personal, which reads this Org too
  // (`services/personal/reach.ts`), named on the Org it lives on.
  const { findPersonalProject } = await import('@/services/workspace/personalProject');
  const personal = await findPersonalProject(userId);
  if (!personal) {
    return null;
  }
  const [home] = await db.select({ slug: tenantAccountSchema.slug }).from(tenantAccountSchema).where(eq(tenantAccountSchema.id, personal.accountId)).limit(1);
  return workspaceUrl(personal.slug, '/dashboard', home ? { accountSlug: home.slug } : {});
}

/**
 * The invite a token names, as the signed-in person who opened the link sees
 * it. The invite's email never leaves the server: someone signed in with a
 * different email learns only that it isn't theirs, not whose it is.
 * @param userId - The signed-in person.
 * @param token - The invite token from the link.
 * @returns The summary, or null when the token matches no invite.
 */
export async function describeInviteForUser(userId: string, token: string): Promise<InviteSummary | null> {
  const invite = await inviteByToken(token);
  if (!invite) {
    return null;
  }
  const email = await emailOf(userId);
  let standing: InviteStanding = 'open';
  if (await isMemberOf(userId, invite.accountId)) {
    standing = 'member';
  } else if (invite.acceptedAt) {
    standing = 'accepted';
  } else if (invite.expiresAt < new Date()) {
    standing = 'expired';
  } else if (invite.email.toLowerCase() !== (email ?? '').toLowerCase()) {
    standing = 'other-email';
  }
  return {
    accountName: invite.accountName,
    role: invite.role as 'admin' | 'member',
    standing,
    openPath: standing === 'member' ? await openPathOnAccount(userId, invite.accountId, invite.accountSlug) : null,
  };
}

/**
 * Join the invite's account on this person's existing user.
 *
 * The invite is claimed with a conditional update (only while it is still
 * unaccepted) in the same transaction as the membership insert, so two
 * clicks, two tabs or a replayed request accept it once and add one row.
 * @param userId - The signed-in person.
 * @param token - The invite token from the link.
 * @returns Where to go next (the account they just joined), or why it was
 *  refused.
 */
export async function acceptInviteAsExistingUser(userId: string, token: string): Promise<AcceptInviteResult> {
  const email = await emailOf(userId);
  if (!email) {
    return { ok: false, status: 403, error: 'Sign in to accept this invite.' };
  }
  const invite = await inviteByToken(token);
  const problem = inviteProblem(invite, email, new Date());
  if (problem || !invite) {
    return { ok: false, ...(problem ?? { status: 404, error: 'Invalid invite token.' }) };
  }
  if (await isMemberOf(userId, invite.accountId)) {
    return { ok: false, status: 409, error: 'You are already a member of this Org.' };
  }
  // A single-Org server (`VOCION_ORGS=single`) holds each person in one Org.
  const refusal = await secondOrgProblem(userId, invite.accountId);
  if (refusal) {
    return { ok: false, status: 409, error: refusal };
  }

  const joined = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(inviteSchema)
      .set({ acceptedAt: new Date() })
      .where(and(eq(inviteSchema.id, invite.id), isNull(inviteSchema.acceptedAt)))
      .returning({ id: inviteSchema.id });
    if (claimed.length === 0) {
      return 'used' as const;
    }
    // Something else (an admin, a seed) may have added them since the check
    // above; the unique index then keeps their existing role, and the invite
    // is spent either way.
    const added = await tx
      .insert(accountMembershipSchema)
      .values({ accountId: invite.accountId, userId, role: invite.role })
      .onConflictDoNothing()
      .returning({ userId: accountMembershipSchema.userId });
    return added.length > 0 ? 'joined' as const : 'already-member' as const;
  });
  if (joined === 'used') {
    return { ok: false, status: 410, error: 'This invite has already been used.' };
  }
  if (joined === 'already-member') {
    return { ok: false, status: 409, error: 'You are already a member of this Org.' };
  }

  // Their own workspace in the account they just joined. Never throws, so a
  // failure here cannot undo an accepted invite; the next sign-in retries.
  await ensurePersonalProjectsForUser(userId);

  return { ok: true, accountId: invite.accountId, openPath: await openPathOnAccount(userId, invite.accountId, invite.accountSlug) };
}

/** What creating a login from an invite needs. */
export type NewUserFromInvite = {
  /** The invite token: from the link's form, or one a provider's verified address matched. */
  inviteToken: string;
  /** The address the person proved: typed on the form, or vouched for by Google, Microsoft or an email link. */
  email: string;
  name: string | null;
  /** The bcrypt hash of the password chosen on the form; null for a login made by Google, Microsoft or an email link. */
  passwordHash: string | null;
};

export type AcceptAsNewUserResult
  = | { ok: true; userId: string; accountId: string }
    | { ok: false; status: 403 | 404 | 409 | 410; error: string; code?: 'EXISTING_USER' };

/**
 * Accept an invite by creating the person's login: the user, their
 * membership with the invite's role, and the invite marked used, in one
 * transaction; then their personal workspace. The one way a user comes to
 * exist through the web — the invite link's form (`/api/signup`) and a first
 * sign-in with Google, Microsoft or an email link
 * (`services/auth/externalSignIn.ts`) both come through here, so a login
 * looks the same however it was made.
 *
 * Someone who already has a login is refused with `code: 'EXISTING_USER'`:
 * they join by signing in (`acceptInviteAsExistingUser`). The invite is
 * claimed with a conditional update, like the existing-login path, so a
 * double submit makes one user.
 * @param input - The invite and the person.
 * @param now - The current time; tests pass one.
 */
export async function acceptInviteAsNewUser(input: NewUserFromInvite, now: Date = new Date()): Promise<AcceptAsNewUserResult> {
  const email = input.email.trim().toLowerCase();
  const existing = { ok: false, status: 409, error: 'You already have a login with this email. Sign in to accept the invite.', code: 'EXISTING_USER' } as const;
  const [user] = await db.select({ id: userSchema.id }).from(userSchema).where(eq(userSchema.email, email)).limit(1);
  if (user) {
    return existing;
  }
  const invite = await inviteByToken(input.inviteToken);
  const problem = inviteProblem(invite, email, now);
  if (problem || !invite) {
    return { ok: false, ...(problem ?? { status: 404, error: 'Invalid invite token.' }) };
  }

  const userId = `usr-${randomUUID()}`;
  const outcome = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(inviteSchema)
      .set({ acceptedAt: now })
      .where(and(eq(inviteSchema.id, invite.id), isNull(inviteSchema.acceptedAt)))
      .returning({ id: inviteSchema.id });
    if (claimed.length === 0) {
      return 'used' as const;
    }
    // A second request for the same email between the check above and here
    // finds the unique email taken: undo the claim and make nothing.
    const created = await tx
      .insert(userSchema)
      .values({ id: userId, name: input.name?.trim() || null, email, passwordHash: input.passwordHash })
      .onConflictDoNothing({ target: userSchema.email })
      .returning({ id: userSchema.id });
    if (created.length === 0) {
      tx.rollback();
    }
    await tx.insert(accountMembershipSchema).values({ accountId: invite.accountId, userId, role: invite.role });
    return 'created' as const;
  }).catch((error: unknown) => {
    if (error instanceof TransactionRollbackError) {
      return 'exists' as const;
    }
    throw error;
  });
  if (outcome === 'exists') {
    return existing;
  }
  if (outcome === 'used') {
    return { ok: false, status: 410, error: 'This invite has already been used.' };
  }

  // Their own workspace in the account the invite joined them to. Never
  // throws, so it cannot fail a sign-up; sign-in retries it.
  await ensurePersonalProjectsForUser(userId);
  return { ok: true, userId, accountId: invite.accountId };
}
