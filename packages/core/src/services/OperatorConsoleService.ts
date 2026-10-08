/**
 * The operator console's reads and writes — `/dashboard/operator`.
 *
 * On a deployment hosting several client accounts, the operator's questions
 * are about accounts, not workspaces: which clients are on it, who is in each,
 * whether anyone has used it lately, what each has spent, and how a new client
 * gets in. Everything here answers across every account, so nothing here may
 * be reached without `isOperatorUser` (`services/operator.ts`) — the router is the
 * guard (`routers/Operator.ts`), and these functions trust their caller.
 *
 * Onboarding is invite-only. An operator creates the account, its first
 * workspace and an admin invite in one move; the admin signs up through the
 * invite link like anyone else (`/api/signup`, `services/InviteAcceptance.ts`)
 * and takes it from there. There is no self-serve sign-up to route around.
 *
 * Privacy line: an operator sees a person's email, account role and when they
 * were last active — what running the deployment needs — and never what is in
 * a workspace. Personal workspaces are counted and their spend is summed into
 * the account, but they are not listed one by one: whose assistant exists is
 * not the operator's business.
 */

import type { AccountCapStatus } from '@/services/BudgetService';
import type { PendingInvite } from '@/services/MembersService';
import { randomUUID } from 'node:crypto';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSlugProblem } from '@/libs/links';
import { accountMembershipSchema, inviteSchema, projectSchema, tenantAccountSchema, userActivityEventSchema, userSchema } from '@/models/Schema';
import { accountCapStatus, spendLedgerStartedOn, spendSince } from '@/services/BudgetService';
import { createInvite, isOperatorWithoutLogin } from '@/services/MembersService';
import { isUniqueViolation } from '@/services/SourceCredentialService';

/** The window the console's spend column covers, in days, today included. */
export const SPEND_WINDOW_DAYS = 30;

export type OperatorWorkspace = {
  id: string;
  slug: string;
  name: string;
  /** Spend over the window, in cents; carries a fraction. */
  spendCents: number;
  /** The newest activity event in the workspace (a person or an agent), ISO-8601; null for none. */
  lastActivityAt: string | null;
};

export type OperatorMember = {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  /** Newer of the last heartbeat and the last sign-in, ISO-8601; null when never seen. */
  lastActiveAt: string | null;
};

export type OperatorInvite = {
  id: string;
  email: string;
  role: string;
  token: string;
  expiresAt: string;
  expired: boolean;
};

export type OperatorAccount = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  /** Shared workspaces, by name. */
  workspaces: OperatorWorkspace[];
  /** Personal workspaces, folded into one line — see the privacy note above. */
  personal: { count: number; spendCents: number; lastActivityAt: string | null };
  members: OperatorMember[];
  /** Unaccepted invites, expired ones included and flagged. */
  invites: OperatorInvite[];
  /** The newest of every workspace's activity and every member's last sign-in or heartbeat. */
  lastActivityAt: string | null;
  /** Spend over the window across every workspace, personal ones included, in cents. */
  spendCents: number;
  /** This month against the operator's cap. */
  cap: AccountCapStatus;
};

export type OperatorOverview = {
  windowDays: number;
  /** The first UTC day the window covers, `YYYY-MM-DD`. */
  windowStartsOn: string;
  /**
   * The first day the spend ledger holds, `YYYY-MM-DD`, or null when it is
   * empty. When it is inside the window, the window's totals start there.
   */
  ledgerStartedOn: string | null;
  accounts: OperatorAccount[];
};

/**
 * The later of two ISO instants, either of which may be missing.
 * @param a - An ISO-8601 instant, or null.
 * @param b - An ISO-8601 instant, or null.
 */
function later(a: string | null, b: string | null): string | null {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return a > b ? a : b;
}

/**
 * A date column as ISO-8601, or null.
 * @param value - The column's value.
 */
function iso(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

/**
 * Every account on the deployment, with what an operator reads first.
 *
 * Five reads for the whole deployment plus one per account for its cap, not a
 * fan-out per workspace: the console is one page over every client.
 */
export async function operatorOverview(): Promise<OperatorOverview> {
  const [accounts, projects, members, invites, ledgerStartedOn] = await Promise.all([
    db.select().from(tenantAccountSchema).orderBy(asc(tenantAccountSchema.name), asc(tenantAccountSchema.id)),
    db
      .select({
        id: projectSchema.id,
        accountId: projectSchema.accountId,
        slug: projectSchema.slug,
        name: projectSchema.name,
        kind: projectSchema.kind,
        // Qualified by hand inside the subquery, as `ProjectService` does: an
        // unqualified "id" would resolve to the event's own id. The
        // (org_id, created_at) index answers max() without a scan. Decoded by
        // the column's own mapper, so the zone-less timestamp reads as UTC
        // exactly as it does on a typed select.
        lastActivityAt: sql<Date | null>`(select max(e."created_at") from "user_activity_event" e where e."org_id" = "project"."id")`.mapWith(userActivityEventSchema.createdAt),
      })
      .from(projectSchema)
      .orderBy(asc(projectSchema.name)),
    db
      .select({
        accountId: accountMembershipSchema.accountId,
        userId: userSchema.id,
        email: userSchema.email,
        name: userSchema.name,
        role: accountMembershipSchema.role,
        lastActiveAt: accountMembershipSchema.lastActiveAt,
        lastLoginAt: accountMembershipSchema.lastLoginAt,
      })
      .from(accountMembershipSchema)
      .innerJoin(userSchema, eq(userSchema.id, accountMembershipSchema.userId))
      .orderBy(asc(userSchema.email)),
    db.select().from(inviteSchema).where(isNull(inviteSchema.acceptedAt)).orderBy(asc(inviteSchema.createdAt)),
    spendLedgerStartedOn(),
  ]);

  const spend = await spendSince(projects.map(p => p.id), SPEND_WINDOW_DAYS);
  const caps = await Promise.all(accounts.map(account => accountCapStatus(account.id)));
  const now = new Date();

  const out: OperatorAccount[] = accounts.map((account, index) => {
    const own = projects.filter(p => p.accountId === account.id);
    const workspaces: OperatorWorkspace[] = own
      .filter(p => p.kind !== 'personal')
      .map(p => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        spendCents: spend.get(p.id)?.spentCents ?? 0,
        lastActivityAt: iso(p.lastActivityAt),
      }));
    const personalRows = own.filter(p => p.kind === 'personal');
    const personal = {
      count: personalRows.length,
      spendCents: personalRows.reduce((sum, p) => sum + (spend.get(p.id)?.spentCents ?? 0), 0),
      lastActivityAt: personalRows.reduce<string | null>((latest, p) => later(latest, iso(p.lastActivityAt)), null),
    };
    const people: OperatorMember[] = members
      .filter(m => m.accountId === account.id)
      .map(m => ({
        userId: m.userId,
        email: m.email,
        name: m.name,
        role: m.role,
        lastActiveAt: later(iso(m.lastActiveAt), iso(m.lastLoginAt)),
      }));
    const pending: OperatorInvite[] = invites
      .filter(i => i.accountId === account.id)
      .map(i => ({ id: i.id, email: i.email, role: i.role, token: i.token, expiresAt: i.expiresAt.toISOString(), expired: i.expiresAt < now }));
    const lastActivityAt = [
      ...workspaces.map(w => w.lastActivityAt),
      personal.lastActivityAt,
      ...people.map(p => p.lastActiveAt),
    ].reduce<string | null>((latest, at) => later(latest, at), null);

    return {
      id: account.id,
      name: account.name,
      slug: account.slug,
      createdAt: account.createdAt.toISOString(),
      workspaces,
      personal,
      members: people,
      invites: pending,
      lastActivityAt,
      spendCents: workspaces.reduce((sum, w) => sum + w.spendCents, 0) + personal.spendCents,
      cap: caps[index]!,
    };
  });

  const windowStartsOn = new Date(now.getTime() - (SPEND_WINDOW_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  return { windowDays: SPEND_WINDOW_DAYS, windowStartsOn, ledgerStartedOn, accounts: out };
}

/**
 * A name as a slug: lowercase, runs of anything else folded to one hyphen,
 * trimmed to the 40 characters a workspace slug allows.
 * @param name - What the operator typed.
 */
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/** Raised for something the operator typed that cannot be used; the message is written for them. */
export class OperatorInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperatorInputError';
  }
}

export type CreatedAccount = {
  account: { id: string; name: string; slug: string };
  workspace: { id: string; slug: string; name: string };
  invite: PendingInvite;
};

/** How many times a create retries when another create took its slug first. */
const CREATE_ATTEMPTS = 5;

/**
 * Every slug a new account with this base could take, as the candidates are
 * built: the base itself, then `-2`, `-3`, … on the base cut to 36 characters,
 * so a suffixed slug still fits the 40 a workspace address allows.
 * @param baseSlug - The name, slugged.
 * @param n - The suffix; 1 for the bare base.
 */
function candidateSlug(baseSlug: string, n: number): string {
  return n === 1 ? baseSlug : `${suffixBase(baseSlug)}-${n}`;
}

/**
 * The part of a base slug a suffix is added to: cut to 36 characters, without
 * a hyphen the cut left at the end.
 * @param baseSlug - The name, slugged.
 */
function suffixBase(baseSlug: string): string {
  return baseSlug.slice(0, 36).replace(/-+$/, '');
}

/**
 * The account and its first workspace, in one transaction, under the first
 * slug nobody holds.
 *
 * The taken set is read with the prefix a suffixed candidate is built on (the
 * cut, not the whole base, which differ once the base is longer than 36), so
 * every candidate this could pick is in it. Two creates with the same name can still both read a slug
 * as free; the second's insert then fails on the unique slug, and it starts
 * again, reading the slug the first one committed.
 * @param opts - The validated names.
 * @param opts.name - The client's name.
 * @param opts.baseSlug - That name, slugged.
 * @param opts.workspaceName - The first workspace's name.
 * @param opts.workspaceSlug - Its address.
 */
async function createAccountRows(opts: { name: string; baseSlug: string; workspaceName: string; workspaceSlug: string }) {
  const { baseSlug } = opts;
  const prefix = `${suffixBase(baseSlug)}-%`;
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const taken = new Set(
          (await tx
            .select({ slug: tenantAccountSchema.slug })
            .from(tenantAccountSchema)
            .where(sql`${tenantAccountSchema.slug} = ${baseSlug} or ${tenantAccountSchema.slug} like ${prefix}`))
            .map(row => row.slug),
        );
        let n = 1;
        while (taken.has(candidateSlug(baseSlug, n))) {
          n++;
        }
        const account = { id: `acct-${randomUUID()}`, name: opts.name, slug: candidateSlug(baseSlug, n) };
        const workspace = { id: `proj-${randomUUID()}`, slug: opts.workspaceSlug, name: opts.workspaceName };
        await tx.insert(tenantAccountSchema).values(account);
        await tx.insert(projectSchema).values({ ...workspace, accountId: account.id, kind: 'shared' });
        return { account, workspace };
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      if (attempt >= CREATE_ATTEMPTS) {
        throw new OperatorInputError(`Another account took the address "${baseSlug}" at the same moment, ${CREATE_ATTEMPTS} times running. Try again.`);
      }
    }
  }
}

/**
 * Create a client account, its first workspace, and an invite for its first
 * admin — the whole of onboarding, since nobody can sign up without an invite.
 *
 * The account slug is unique across the deployment, so a taken one gets the
 * next free `-2`, `-3`, … rather than refusing a company for sharing a name.
 * The workspace is shared and named after the account unless the operator
 * names it; its slug has to be one the router can open (`projectSlugProblem`).
 *
 * The account and workspace are one transaction. The invite is written after
 * it, through the same `createInvite` the members page uses, so an invite made
 * here is exactly an invite made there. A brand-new account has no members, so
 * the only way it fails is the database — and the account then shows on the
 * console with no admin, where `inviteToAccount` issues one.
 * @param opts - What the operator entered.
 * @param opts.name - The client's name.
 * @param opts.workspaceName - The first workspace's name; defaults to the client's.
 * @param opts.adminEmail - Who gets the admin invite.
 * @param opts.invitedBy - The operator's user id, recorded on the invite.
 */
export async function createAccount(opts: {
  name: string;
  workspaceName?: string;
  adminEmail: string;
  invitedBy: string;
}): Promise<CreatedAccount> {
  const name = opts.name.trim();
  const baseSlug = slugFromName(name);
  if (!baseSlug) {
    throw new OperatorInputError('The account name needs at least one letter or number.');
  }
  const workspaceName = opts.workspaceName?.trim() || name;
  const workspaceSlug = slugFromName(workspaceName);
  const workspaceProblem = projectSlugProblem(workspaceSlug);
  if (workspaceProblem) {
    throw new OperatorInputError(`The workspace's address "${workspaceSlug}" ${workspaceProblem}. Pick another workspace name.`);
  }

  // Before anything is created: an admin invite that could never be used
  // would leave an account with nobody able to get in.
  if (await isOperatorWithoutLogin(opts.adminEmail.trim().toLowerCase())) {
    throw new OperatorInputError(`${opts.adminEmail.trim()} operates this deployment and has no login yet, so it cannot be invited: an operator's login is created on the instance (create-local-user). Invite another address, or create that login first.`);
  }

  const created = await createAccountRows({ name, baseSlug, workspaceName, workspaceSlug });

  const invite = await createInvite({ accountId: created.account.id, email: opts.adminEmail, role: 'admin', invitedBy: opts.invitedBy });
  return { ...created, invite };
}

/**
 * Invite someone into an existing account — an admin when the first invite
 * expired or went to the wrong person. The members page's `createInvite`,
 * reached by an operator who is not in the account.
 * @param opts - The invite.
 * @param opts.accountId - `tenant_account.id`.
 * @param opts.email - Who it is for.
 * @param opts.role - Their account role.
 * @param opts.invitedBy - The operator's user id.
 */
export async function inviteToAccount(opts: {
  accountId: string;
  email: string;
  role: 'admin' | 'member';
  invitedBy: string;
}): Promise<PendingInvite> {
  const [account] = await db.select({ id: tenantAccountSchema.id }).from(tenantAccountSchema).where(eq(tenantAccountSchema.id, opts.accountId)).limit(1);
  if (!account) {
    throw new OperatorInputError('That account does not exist.');
  }
  try {
    return await createInvite(opts);
  } catch (error) {
    // `createInvite`'s one refusal is written for a person ("already a member").
    throw new OperatorInputError(error instanceof Error ? error.message : 'Could not create the invite.');
  }
}

/**
 * Whether an account exists — the cap setter's check, so a typo'd id does not
 * leave a budget row for an account nobody has.
 * @param accountId - `tenant_account.id`.
 */
export async function accountExists(accountId: string): Promise<boolean> {
  const [row] = await db.select({ id: tenantAccountSchema.id }).from(tenantAccountSchema).where(eq(tenantAccountSchema.id, accountId)).limit(1);
  return Boolean(row);
}
