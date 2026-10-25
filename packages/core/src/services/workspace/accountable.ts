/**
 * THE WORKSPACE'S ACCOUNTABLE PERSON: who its updates are mailed to when a
 * mission or report names no address (`project.accountable_user_id`).
 *
 * A self-hosted workspace sets it in `workspace.yaml` (`accountableUser`). A
 * Vocion Cloud workspace has no manifest, so until now nothing set it: a
 * one-click Marketing install delivered its daily update to nobody ("no
 * recipient"). Three things close that:
 * - an app install on a workspace with no accountable person makes the admin
 *   who installed it accountable ({@link defaultAccountable});
 * - admins change it on the Members page ({@link setAccountable});
 * - a delivery that still finds no one raises one ask to an admin instead of
 *   failing quietly ({@link askForAccountable}).
 */

import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { accountMembershipSchema, projectSchema, userSchema } from '@/models/Schema';

/** One open ask at a time per workspace: re-filing refreshes it in place. */
export const ACCOUNTABLE_ASK_REF = 'workspace:accountable-missing';

export type AccountablePerson = { userId: string; name: string | null; email: string | null };

export class AccountableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountableError';
  }
}

/**
 * Who is accountable for this workspace, or null.
 * @param orgId - The workspace.
 */
export async function readAccountable(orgId: string): Promise<AccountablePerson | null> {
  const [row] = await db
    .select({ userId: userSchema.id, name: userSchema.name, email: userSchema.email })
    .from(projectSchema)
    .innerJoin(userSchema, eq(userSchema.id, projectSchema.accountableUserId))
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  return row ?? null;
}

/**
 * The user id a caller string names: `user:<id>` (the routers' `appliedBy`)
 * or a bare id (an action's `invokedBy`). Anything else names no person.
 * @param by - Who acted.
 */
export function personFrom(by: string | null | undefined): string | null {
  const id = (by ?? '').trim().replace(/^user:/, '');
  return id && !id.includes(':') && !/\s/.test(id) ? id : null;
}

async function accountOf(orgId: string): Promise<string | null> {
  const [p] = await db.select({ accountId: projectSchema.accountId }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  return p?.accountId ?? null;
}

async function isMember(accountId: string, userId: string): Promise<boolean> {
  const [m] = await db.select({ userId: accountMembershipSchema.userId }).from(accountMembershipSchema).where(and(eq(accountMembershipSchema.accountId, accountId), eq(accountMembershipSchema.userId, userId))).limit(1);
  return Boolean(m);
}

/**
 * Make `userId` accountable for the workspace. They must be a member of its
 * Org. Closes the open "who gets the updates?" ask, if one is waiting.
 * @param opts
 * @param opts.orgId - The workspace.
 * @param opts.userId - The member who becomes accountable.
 */
export async function setAccountable(opts: { orgId: string; userId: string }): Promise<AccountablePerson> {
  const accountId = await accountOf(opts.orgId);
  if (!accountId || !(await isMember(accountId, opts.userId))) {
    throw new AccountableError('That person is not a member of this workspace\'s Org.');
  }
  await db.update(projectSchema).set({ accountableUserId: opts.userId }).where(eq(projectSchema.id, opts.orgId));
  await closeAccountableAsk(opts.orgId);
  return (await readAccountable(opts.orgId))!;
}

/**
 * On an app install: when the workspace has no accountable person, the admin
 * who installed the app becomes accountable. A person already set is never
 * replaced. Returns who was made accountable, or null when nothing changed.
 * @param orgId - The workspace.
 * @param by - Who installed (`user:<id>` or an id).
 */
export async function defaultAccountable(orgId: string, by: string | null | undefined): Promise<string | null> {
  const userId = personFrom(by);
  if (!userId) {
    return null;
  }
  const [p] = await db.select({ accountId: projectSchema.accountId, accountableUserId: projectSchema.accountableUserId }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  if (!p || p.accountableUserId || !p.accountId || !(await isMember(p.accountId, userId))) {
    return null;
  }
  await db.update(projectSchema).set({ accountableUserId: userId }).where(eq(projectSchema.id, orgId));
  await closeAccountableAsk(orgId);
  return userId;
}

/**
 * A delivery found nobody to send to: ask an admin, once, who should get this
 * workspace's updates. Never throws; an ask that cannot be filed is logged.
 * @param orgId - The workspace.
 * @param what - What could not be delivered ("Daily marketing update").
 */
export async function askForAccountable(orgId: string, what: string): Promise<void> {
  try {
    const accountId = await accountOf(orgId);
    if (!accountId) {
      return;
    }
    const [admin] = await db
      .select({ userId: accountMembershipSchema.userId })
      .from(accountMembershipSchema)
      .where(and(eq(accountMembershipSchema.accountId, accountId), eq(accountMembershipSchema.role, 'admin')))
      .orderBy(asc(accountMembershipSchema.createdAt))
      .limit(1);
    const { upsertAsk } = await import('@/services/AskService');
    await upsertAsk({
      orgId,
      createdBy: 'system:deliver',
      ask: {
        kind: 'setup',
        title: 'Who should get this workspace\'s updates?',
        body: `${what} was ready but had no one to go to: this workspace has no accountable person. Choose one on the Members page and the next update goes to them.`,
        sourceRef: ACCOUNTABLE_ASK_REF,
        risk: 'low',
        contextUrl: '/dashboard/members',
        projectId: orgId,
        ...(admin ? { ownerUserId: admin.userId } : {}),
      },
    });
  } catch (err) {
    console.warn('[accountable] could not ask for an accountable person', { orgId, error: (err as Error).message });
  }
}

async function closeAccountableAsk(orgId: string): Promise<void> {
  const { getAskBySourceRef, supersedeAsk } = await import('@/services/AskService');
  const open = await getAskBySourceRef(orgId, ACCOUNTABLE_ASK_REF);
  if (open?.status === 'open') {
    await supersedeAsk(orgId, open.id, 'An accountable person was set.');
  }
}

/**
 * Whether a delivery's mail reason means there was no one to send to. Pure.
 * @param reason
 */
export function noRecipient(reason: string | undefined): boolean {
  return typeof reason === 'string' && reason.startsWith('no recipient');
}
