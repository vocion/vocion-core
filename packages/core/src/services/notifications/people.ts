import type { NotificationWho } from '@/libs/notifications/types';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSchema, userSchema } from '@/models/Schema';
import { listMembers } from '@/services/MembersService';
import { enforcementEnabled, reachForAccount } from '@/services/WorkspaceAccessService';

/** A person who can open a workspace, and the role they hold in it. */
export type WorkspacePerson = { userId: string; email: string; name: string | null; role: 'admin' | 'member' };

/**
 * Everyone who can open this workspace — the same answer the members page
 * gives, from the account's roster and what each person reaches.
 * @param orgId - The workspace (project id).
 */
export async function workspacePeople(orgId: string): Promise<WorkspacePerson[]> {
  const [project] = await db.select({ accountId: projectSchema.accountId, kind: projectSchema.kind, ownerUserId: projectSchema.ownerUserId }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  if (!project) {
    return [];
  }
  const members = await listMembers(project.accountId);
  if (!enforcementEnabled()) {
    // Unenforced (the default), everyone on the account opens every workspace
    // on it (`ProjectService.listProjectsForUser`) — except a personal one,
    // which is its owner's alone.
    return members
      .filter(m => project.kind !== 'personal' || m.userId === project.ownerUserId)
      .map(m => ({ userId: m.userId, email: m.email, name: m.name, role: m.role === 'admin' || m.userId === project.ownerUserId ? 'admin' : 'member' }));
  }
  const reach = await reachForAccount(project.accountId, members.map(m => m.userId));
  const out: WorkspacePerson[] = [];
  for (const m of members) {
    const access = reach.get(m.userId)?.find(a => a.projectId === orgId);
    if (access) {
      out.push({ userId: m.userId, email: m.email, name: m.name, role: access.role === 'admin' ? 'admin' : 'member' });
    }
  }
  return out;
}

/** Who a rule reached, and in words why when it reached nobody. */
export type Recipients = { userIds: string[]; note: string | null };

/**
 * Resolve a rule's `who` to people who can open the workspace. A name that
 * resolves to someone outside it is dropped: a notification never tells a
 * person about a workspace they cannot open.
 * @param orgId - The workspace.
 * @param who - The rule's `who`.
 * @param payload - The event's payload, for `{ field }`.
 */
export async function resolveRecipients(orgId: string, who: NotificationWho | NotificationWho[], payload: Record<string, unknown>): Promise<Recipients> {
  const list = Array.isArray(who) ? who : [who];
  const people = await workspacePeople(orgId);
  const byId = new Map(people.map(p => [p.userId, p]));
  const byEmail = new Map(people.map(p => [p.email.toLowerCase(), p]));
  const chosen = new Set<string>();
  const notes: string[] = [];
  let accountable: string | null | undefined;
  for (const w of list) {
    if (w === 'members') {
      people.forEach(p => chosen.add(p.userId));
    } else if (w === 'admins') {
      people.filter(p => p.role === 'admin').forEach(p => chosen.add(p.userId));
    } else if (w === 'accountable') {
      if (accountable === undefined) {
        const [row] = await db.select({ id: projectSchema.accountableUserId }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
        accountable = row?.id ?? null;
      }
      if (accountable && byId.has(accountable)) {
        chosen.add(accountable);
      } else {
        // No accountable human named (workspace.yaml `accountableUser`): the
        // admins hear it, and the rule's note says so.
        const admins = people.filter(p => p.role === 'admin');
        admins.forEach(p => chosen.add(p.userId));
        notes.push(`no accountable user is set, so the ${admins.length === 1 ? 'admin' : `${admins.length} admins`} heard it`);
      }
    } else if ('user' in w) {
      const p = byEmail.get(w.user.toLowerCase());
      if (p) {
        chosen.add(p.userId);
      } else {
        notes.push(`${w.user} cannot open this workspace`);
      }
    } else {
      const value = payload[w.field];
      const ids = (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string' && v.length > 0);
      if (ids.length === 0) {
        notes.push(`the event carried no ${w.field}`);
      }
      for (const v of ids) {
        const p = byId.get(v) ?? byEmail.get(v.toLowerCase());
        if (p) {
          chosen.add(p.userId);
        } else {
          notes.push(`${w.field} names someone who cannot open this workspace`);
        }
      }
    }
  }
  return { userIds: [...chosen], note: notes.length > 0 ? notes.join('; ') : null };
}

/**
 * Email and name for a set of users, for the email and Slack channels.
 * @param userIds - The people.
 */
export async function contactsOf(userIds: readonly string[]): Promise<Map<string, { email: string; name: string | null }>> {
  if (userIds.length === 0) {
    return new Map();
  }
  const rows = await db.select({ id: userSchema.id, email: userSchema.email, name: userSchema.name }).from(userSchema).where(inArray(userSchema.id, [...userIds]));
  return new Map(rows.map(r => [r.id, { email: r.email, name: r.name }]));
}
