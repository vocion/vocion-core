/**
 * members.invite — invite people into this workspace's account, from a
 * conversation.
 *
 * The same invite the Members page makes (`MembersService.createInvite`): a
 * link-based invite per address, good for two weeks, refused for someone who
 * is already a member — and delivered the same way (`deliverInvite`): mailed
 * when this server sends mail, and told in the app to a person who already has
 * a login. The links are on the Members page too, which is where the done card
 * points.
 *
 * Reversible: `undo` withdraws every invite this run made that nobody has
 * accepted yet (an accepted invite is a person who joined; that is theirs, not
 * Undo's). Internal. Only an account admin can invite, here as on the Members
 * page: the check reads the person who decided the card, never the agent that
 * offered it.
 */

import type { Action, ActionContext } from './types';
import { z } from 'zod';

const membersInviteInput = z.object({
  /** Who to invite — one to ten email addresses. */
  emails: z.array(z.string().trim().toLowerCase().pipe(z.email())).min(1).max(10),
  /** The role they join with. Member unless the person said admin. */
  role: z.enum(['member', 'admin']).default('member'),
});

export type MembersInviteInput = z.infer<typeof membersInviteInput>;

/** Where the invite links are, to copy and share. */
export const MEMBERS_HREF = '/dashboard/members';

/**
 * The account this workspace belongs to.
 * @param orgId - The workspace (project).
 */
async function accountOf(orgId: string): Promise<string | null> {
  const [{ db }, { projectSchema }, { eq }] = await Promise.all([import('@/libs/DB'), import('@/models/Schema'), import('drizzle-orm')]);
  const [row] = await db.select({ accountId: projectSchema.accountId }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  return row?.accountId ?? null;
}

/**
 * The person behind this run — who decided it, else whose turn proposed it —
 * when they are a user of this account, with their role there.
 * @param ctx - The action's context.
 * @param accountId - The workspace's account.
 */
async function personIn(ctx: ActionContext, accountId: string): Promise<{ userId: string; role: string } | null> {
  const candidate = ctx.reviewedBy ?? ctx.origin?.userId ?? ctx.invokedBy;
  if (!candidate) {
    return null;
  }
  const [{ db }, { accountMembershipSchema }, { and, eq }] = await Promise.all([import('@/libs/DB'), import('@/models/Schema'), import('drizzle-orm')]);
  const [row] = await db
    .select({ role: accountMembershipSchema.role })
    .from(accountMembershipSchema)
    .where(and(eq(accountMembershipSchema.accountId, accountId), eq(accountMembershipSchema.userId, candidate)))
    .limit(1);
  return row ? { userId: candidate, role: row.role } : null;
}

/**
 * The addresses already in the account, of those asked about.
 * @param accountId - The account.
 * @param emails - Lower-cased addresses.
 */
async function alreadyMembers(accountId: string, emails: readonly string[]): Promise<Set<string>> {
  const { listMembers } = await import('@/services/MembersService');
  const members = new Set((await listMembers(accountId)).map(m => m.email.toLowerCase()));
  return new Set(emails.filter(e => members.has(e)));
}

/**
 * "ana@… and ben@…", "3 people".
 * @param emails - The addresses.
 */
function whoWords(emails: readonly string[]): string {
  if (emails.length === 1) {
    return emails[0]!;
  }
  if (emails.length === 2) {
    return `${emails[0]} and ${emails[1]}`;
  }
  return `${emails.length} people`;
}

export const membersInviteAction: Action<typeof membersInviteInput> = {
  id: 'members.invite',
  name: 'Invite teammates',
  description: 'Invite people into this workspace by email (emailed when this server sends mail; the links are on the Members page either way). Reversible — undo withdraws the invites nobody has accepted yet.',
  inputSchema: membersInviteInput,
  grant: 'manage_members',
  external: false,
  dedupKeyFor: input => `members.invite:${[...input.emails].sort().join(',')}`,

  async precheck(ctx, input) {
    const accountId = await accountOf(ctx.orgId);
    if (!accountId) {
      return 'this workspace belongs to no account, so there is nobody to invite people into';
    }
    const members = await alreadyMembers(accountId, input.emails);
    if (members.size === input.emails.length) {
      return `${whoWords([...members])} ${members.size === 1 ? 'is' : 'are'} already in this workspace`;
    }
    return undefined;
  },

  async reviewCard(_ctx, input) {
    return {
      title: `Invite ${whoWords(input.emails)}`,
      system: 'Members',
      headline: `Invite ${whoWords(input.emails)} as ${input.role === 'admin' ? 'admins' : 'members'}.`,
      badges: [{ label: 'Reversible' }],
      fields: [
        { label: 'Who', value: input.emails.join(', ') },
        { label: 'Role', value: input.role },
      ],
      links: [{ label: 'Members', href: MEMBERS_HREF }],
      nextAction: 'Inviting emails each person a link when this server sends mail; the links are on Members to share either way. Undo withdraws any nobody has used.',
      verbs: { approve: 'Invite', reject: 'Not now' },
    };
  },

  async execute(ctx, input) {
    const accountId = await accountOf(ctx.orgId);
    if (!accountId) {
      throw new Error('This workspace belongs to no account, so there is nobody to invite people into.');
    }
    const person = await personIn(ctx, accountId);
    if (person?.role !== 'admin') {
      throw new Error('Only an admin can invite people. Ask an admin to accept this card, or to invite them from Members.');
    }
    const [{ createInvite }, { deliverInvite }] = await Promise.all([import('@/services/MembersService'), import('@/services/InviteMail')]);
    const members = await alreadyMembers(accountId, input.emails);
    const invites: Array<{ id: string; email: string; emailed: boolean }> = [];
    const skipped: Array<{ email: string; reason: string }> = [];
    for (const email of input.emails) {
      if (members.has(email)) {
        skipped.push({ email, reason: 'already a member' });
        continue;
      }
      const invite = await createInvite({ accountId, email, role: input.role, invitedBy: person.userId });
      const delivery = await deliverInvite({ accountId, inviteId: invite.id, email: invite.email, invitedBy: person.userId, requestOrigin: null });
      invites.push({ id: invite.id, email: invite.email, emailed: delivery.status === 'sent' });
    }
    return { invited: invites.length > 0, invites, skipped, role: input.role, membersHref: MEMBERS_HREF };
  },

  async undo(ctx, _input, result) {
    const invites = Array.isArray(result.invites) ? (result.invites as Array<{ id?: unknown; email?: unknown }>) : [];
    const accountId = await accountOf(ctx.orgId);
    if (!accountId || invites.length === 0) {
      return { undone: false, reason: 'no invite to withdraw' };
    }
    const [{ db }, { inviteSchema }, { and, eq, inArray, isNull }] = await Promise.all([import('@/libs/DB'), import('@/models/Schema'), import('drizzle-orm')]);
    const ids = invites.map(i => String(i.id ?? '')).filter(Boolean);
    // Only what nobody used: an accepted invite is a person who has joined.
    const withdrawn = await db
      .delete(inviteSchema)
      .where(and(eq(inviteSchema.accountId, accountId), inArray(inviteSchema.id, ids), isNull(inviteSchema.acceptedAt)))
      .returning({ email: inviteSchema.email });
    return { undone: true, withdrawn: withdrawn.map(w => w.email), kept: ids.length - withdrawn.length };
  },
};
