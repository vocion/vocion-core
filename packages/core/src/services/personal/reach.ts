/**
 * WHICH ORGS A PERSON'S ONE PERSONAL READS ACROSS, AND HOW FAR.
 *
 * A person has one Personal per installation (`workspace/personalProject.ts`).
 * It reads in place, with that person's own access in each Org, across every
 * Org they belong to: what is waiting on them, their briefs, their views, and
 * the asks they send into workspaces. Results stay in Personal; nothing read
 * from one Org is ever written into another Org's workspaces, and an Org's own
 * agents never see Personal (their tools are scoped to their workspace, and a
 * Personal is visible to its owner alone, `WorkspaceAccessService`).
 *
 * Each Org reached carries a mode:
 *
 * - `full` — its items, with their content, labelled with the Org's name.
 * - `counts` — the Org turned off "Include in members' Personal"
 *   (`tenant_account.include_in_personal`, migration 0208), for a client whose
 *   contract forbids aggregation. Personal shows how many items wait there and
 *   a link into the Org, never what they say.
 *
 * Single-Org install: the home Org only, `full`, exactly as before (a fixture
 * that puts someone in two Orgs there still reads one). The setting only
 * means something where there is more than one Org to aggregate across.
 * The home Org (where the Personal itself lives) is always `full`: reading an
 * Org's items into a workspace on that same Org aggregates nothing.
 */

import { asc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { accountMembershipSchema, tenantAccountSchema } from '@/models/Schema';
import { orgsMode } from '@/services/OrgPolicy';

export type ReachMode = 'full' | 'counts';

/** One Org a Personal reads across. */
export type ReachedOrg = {
  accountId: string;
  name: string;
  slug: string;
  mode: ReachMode;
  /** The Org the Personal itself lives on. */
  home: boolean;
};

/**
 * The mode one Org is read in, as a pure rule.
 * @param input - The Org's facts.
 * @param input.home - Whether the Personal lives on it.
 * @param input.includeInPersonal - Its "Include in members' Personal" setting.
 * @param input.multiOrg - Whether the deployment runs several Orgs.
 */
export function reachMode(input: { home: boolean; includeInPersonal: boolean; multiOrg: boolean }): ReachMode {
  if (!input.multiOrg || input.home) {
    return 'full';
  }
  return input.includeInPersonal ? 'full' : 'counts';
}

/**
 * Every Org this person's Personal reads across: home (where the Personal
 * lives) first, then oldest membership first — the order every Org list reads in.
 * @param userId - The person.
 */
export async function personalReach(userId: string): Promise<ReachedOrg[]> {
  const rows = await db
    .select({ accountId: tenantAccountSchema.id, name: tenantAccountSchema.name, slug: tenantAccountSchema.slug, includeInPersonal: tenantAccountSchema.includeInPersonal })
    .from(accountMembershipSchema)
    .innerJoin(tenantAccountSchema, eq(tenantAccountSchema.id, accountMembershipSchema.accountId))
    .where(eq(accountMembershipSchema.userId, userId))
    .orderBy(asc(accountMembershipSchema.createdAt), asc(accountMembershipSchema.accountId));
  const multiOrg = orgsMode() === 'multi';
  // Home is where the Personal lives (else the oldest membership), and it reads first.
  const { findPersonalProject } = await import('@/services/workspace/personalProject');
  const homeId = (await findPersonalProject(userId))?.accountId ?? rows[0]?.accountId;
  const ordered = [...rows.filter(r => r.accountId === homeId), ...rows.filter(r => r.accountId !== homeId)];
  // A single-Org install reads its one Org: exactly what Personal read before.
  const reached = multiOrg ? ordered : ordered.slice(0, 1);
  return reached.map(r => ({
    accountId: r.accountId,
    name: r.name,
    slug: r.slug,
    home: r.accountId === homeId,
    mode: reachMode({ home: r.accountId === homeId, includeInPersonal: r.includeInPersonal, multiOrg }),
  }));
}

/**
 * The person's reach as a lookup, for code that has an account id in hand.
 * @param reach - From {@link personalReach}.
 */
export function reachByAccount(reach: readonly ReachedOrg[]): Map<string, ReachedOrg> {
  return new Map(reach.map(r => [r.accountId, r]));
}

/**
 * Whether this Org's items may be read into Personal with their content.
 * An Org the person does not belong to is never reached.
 * @param reach - From {@link personalReach}.
 * @param accountId - The Org.
 */
export function readsContent(reach: readonly ReachedOrg[], accountId: string): boolean {
  return reach.some(r => r.accountId === accountId && r.mode === 'full');
}

/**
 * Turn one Org's "Include in members' Personal" on or off. The caller checks
 * the person is the Org's admin.
 * @param accountId - The Org.
 * @param include - On or off.
 */
export async function setIncludeInPersonal(accountId: string, include: boolean): Promise<void> {
  await db.update(tenantAccountSchema).set({ includeInPersonal: include }).where(eq(tenantAccountSchema.id, accountId));
}

/**
 * Whether one Org is included in its members' Personal.
 * @param accountId - The Org.
 */
export async function includeInPersonal(accountId: string): Promise<boolean> {
  const [row] = await db.select({ include: tenantAccountSchema.includeInPersonal }).from(tenantAccountSchema).where(eq(tenantAccountSchema.id, accountId)).limit(1);
  return row?.include ?? true;
}
