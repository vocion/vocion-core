import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { agentSchema, projectSchema, teamSchema } from '@/models/Schema';
import { workspacePeople } from '@/services/notifications/people';

/**
 * WHO IS ACCOUNTABLE FOR A DECISION WAITING ON NEEDS YOU — the person an
 * escalation goes to. Autonomous cannot mean unowned (design value 1).
 *
 * In order: the accountable human of the team that asked (the ask's
 * `teamSlug`, else the asking agent's team); the workspace's accountable human
 * (`accountableUser` in workspace.yaml); the workspace's owner (a personal
 * workspace's person); else every admin, and the source says so. Only people
 * who can open the workspace — a name that resolves to someone outside it is
 * passed over, never told about a workspace they cannot see.
 */

export type OwnerSource = 'team' | 'workspace' | 'owner' | 'admins' | 'nobody';

export type DecisionOwner = { userIds: string[]; source: OwnerSource };

/** Per-sweep memo, so a hundred decisions from one team cost one lookup. */
export type OwnerCache = Map<string, Promise<DecisionOwner>>;

export function newOwnerCache(): OwnerCache {
  return new Map();
}

/**
 * The accountable owner of one decision.
 * @param orgId - The workspace.
 * @param who - What the decision says about who asked.
 * @param who.teamSlug - The team it was asked for, when it says.
 * @param who.agentSlug - The agent that asked, when one did.
 * @param cache - A per-sweep memo.
 */
export async function decisionOwner(orgId: string, who: { teamSlug?: string | null; agentSlug?: string | null }, cache: OwnerCache = newOwnerCache()): Promise<DecisionOwner> {
  const key = `${orgId}|${who.teamSlug ?? ''}|${who.agentSlug ?? ''}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = resolve(orgId, who);
    cache.set(key, hit);
  }
  return hit;
}

async function resolve(orgId: string, who: { teamSlug?: string | null; agentSlug?: string | null }): Promise<DecisionOwner> {
  const people = await workspacePeople(orgId);
  const canOpen = new Set(people.map(p => p.userId));
  let teamSlug = who.teamSlug ?? null;
  if (!teamSlug && who.agentSlug) {
    const [agent] = await db.select({ teamSlug: agentSchema.teamSlug }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, who.agentSlug))).limit(1);
    teamSlug = agent?.teamSlug ?? null;
  }
  if (teamSlug) {
    const [team] = await db.select({ accountable: teamSchema.accountableUserId }).from(teamSchema).where(and(eq(teamSchema.orgId, orgId), eq(teamSchema.slug, teamSlug))).limit(1);
    if (team?.accountable && canOpen.has(team.accountable)) {
      return { userIds: [team.accountable], source: 'team' };
    }
  }
  const [project] = await db.select({ accountable: projectSchema.accountableUserId, owner: projectSchema.ownerUserId }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  if (project?.accountable && canOpen.has(project.accountable)) {
    return { userIds: [project.accountable], source: 'workspace' };
  }
  if (project?.owner && canOpen.has(project.owner)) {
    return { userIds: [project.owner], source: 'owner' };
  }
  const admins = people.filter(p => p.role === 'admin').map(p => p.userId);
  return admins.length > 0 ? { userIds: admins, source: 'admins' } : { userIds: [], source: 'nobody' };
}
