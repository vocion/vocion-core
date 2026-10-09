/**
 * The shared workspaces a person's own assistant may work in on their behalf.
 *
 * The assistant lives in the person's one Personal. It reaches the shared
 * workspaces the person can act in — the same set their switcher lists
 * (`listProjectsForUser`, which applies the rule `actAs` applies, with
 * workspace access enforced or not) — in every Org their Personal reads
 * across in full (`services/personal/reach.ts`): on a single-Org install,
 * that Org. An Org that keeps its items out of Personal is not asked from
 * Personal; the person asks there, in place. Never anyone's personal
 * workspace, their own included: that is where the assistant already is.
 *
 * An ask runs IN the asked workspace, as the person, and is charged there:
 * that Org pays for work done on its data. Nothing read in one Org is written
 * into another's workspaces by this path; the ask carries the person's
 * request, and the answer comes back to Personal.
 *
 * Listing is the menu, not the permission. Every ask resolves its workspace
 * here and then calls `actAs` again, so a grant removed between the two reads
 * is honoured, and a workspace that is not one of theirs answers exactly like
 * one that does not exist.
 */

import type { ActingIdentity } from './actAs';
import { and, inArray, ne } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { agentSchema, projectSchema } from '@/models/Schema';
import { personalReach } from '@/services/personal/reach';
import { listProjectsForUser } from '@/services/ProjectService';
import { actAs } from './actAs';

/** One workspace as the assistant sees it. */
export type ActingWorkspace = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  /** The agent that answers there when nobody is named — the workspace lead. Null when none is set. */
  lead: { slug: string; name: string; description: string | null } | null;
  /** Its Org, so a list across several says which is which. */
  org: { id: string; name: string };
};

/**
 * The shared workspaces this person can act in from their Personal, by name:
 * every Org it reaches in full (`personalReach`), or only `accountId` when a
 * caller narrows to one Org.
 * @param userId - The person.
 * @param accountId - Only this Org; omitted (or null), every Org the Personal reaches in full.
 */
export async function listActingWorkspaces(userId: string, accountId?: string | null): Promise<ActingWorkspace[]> {
  const reach = (await personalReach(userId)).filter(o => o.mode === 'full' && (!accountId || o.accountId === accountId));
  const orgName = new Map(reach.map(o => [o.accountId, o.name]));
  const reachable = (await listProjectsForUser(userId)).filter(p => orgName.has(p.accountId) && !p.archived).map(p => p.id);
  if (reachable.length === 0) {
    return [];
  }
  const projects = await db
    .select({ id: projectSchema.id, accountId: projectSchema.accountId, slug: projectSchema.slug, name: projectSchema.name, description: projectSchema.description, leadAgentSlug: projectSchema.leadAgentSlug })
    .from(projectSchema)
    .where(and(inArray(projectSchema.id, reachable), inArray(projectSchema.accountId, [...orgName.keys()]), ne(projectSchema.kind, 'personal')));
  const leads = projects.filter(p => p.leadAgentSlug);
  const leadRows = leads.length === 0
    ? []
    : await db
        .select({ orgId: agentSchema.orgId, slug: agentSchema.slug, name: agentSchema.name, description: agentSchema.description })
        .from(agentSchema)
        .where(inArray(agentSchema.orgId, leads.map(p => p.id)));
  return projects
    .map((p) => {
      const lead = leadRows.find(a => a.orgId === p.id && a.slug === p.leadAgentSlug);
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        description: p.description ?? null,
        lead: lead ? { slug: lead.slug, name: lead.name, description: lead.description ?? null } : null,
        org: { id: p.accountId, name: orgName.get(p.accountId) ?? '' },
      };
    })
    .sort((a, b) => a.org.name.localeCompare(b.org.name) || a.name.localeCompare(b.name));
}

/**
 * One of those workspaces, by what the assistant called it — its id, its slug
 * or its name, compared whole and without case (an identifier the assistant
 * read off {@link listActingWorkspaces}, never a person's sentence) — with the
 * identity to act there, from `actAs` on this call.
 *
 * Null for anything that is not one of this person's shared workspaces on the
 * account: a workspace that does not exist, one on another account, one they
 * hold no grant on, and anyone's personal workspace. The caller says "not
 * found" for all of them alike.
 * @param userId - The person.
 * @param accountId - Only this Org; null, every Org the Personal reaches in full.
 * @param ref - The workspace as named.
 */
export async function resolveActingWorkspace(userId: string, accountId: string | null, ref: string): Promise<{ workspace: ActingWorkspace; identity: ActingIdentity } | null> {
  const wanted = ref.trim().toLowerCase();
  if (!wanted) {
    return null;
  }
  const workspace = (await listActingWorkspaces(userId, accountId))
    .find(w => w.id.toLowerCase() === wanted || w.slug.toLowerCase() === wanted || w.name.trim().toLowerCase() === wanted);
  if (!workspace) {
    return null;
  }
  const identity = await actAs(userId, workspace.id);
  if (!identity || identity.accountId !== workspace.org.id) {
    return null;
  }
  return { workspace, identity };
}
