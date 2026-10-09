/**
 * PERSONAL READS IN PLACE, ACROSS THE PERSON'S ORGS (`reach.ts` says which
 * Orgs and how far).
 *
 * Every read here is one the person could make by switching: the workspaces
 * come from `listProjectsForUser` (their own access, workspace grants
 * included), narrowed to the Orgs their Personal reaches. Content comes back
 * only from Orgs read in `full`; an Org read in `counts` gives a number and a
 * link into it. Nothing is written anywhere but the Personal the read is for.
 */

import type { ReachedOrg } from './reach';
import type { StateContext, StateQuery, StateRead } from '@/services/state/state';
import { workspaceUrl } from '@/libs/links';
import { listProjectsForUser } from '@/services/ProjectService';
import { personalReach } from './reach';

/** A workspace a Personal reads, with its Org. */
export type ReachedWorkspace = { id: string; slug: string; name: string; accountId: string; accountName: string; accountSlug: string; mode: ReachedOrg['mode'] };

/** An Org kept out of Personal: how many matched there, and the door. */
export type WithheldCount = { accountName: string; workspace: string; count: number; link: string };

/**
 * The shared workspaces a Personal reads across, with each one's Org and mode.
 * @param userId - The person.
 * @param reach - Their reach, when already read.
 */
export async function reachedWorkspaces(userId: string, reach?: readonly ReachedOrg[]): Promise<ReachedWorkspace[]> {
  const orgs = reach ?? await personalReach(userId);
  const byAccount = new Map(orgs.map(o => [o.accountId, o]));
  return (await listProjectsForUser(userId))
    .filter(p => p.kind !== 'personal' && !p.archived && byAccount.has(p.accountId))
    .map((p) => {
      const o = byAccount.get(p.accountId)!;
      return { id: p.id, slug: p.slug, name: p.name, accountId: p.accountId, accountName: o.name, accountSlug: o.slug, mode: o.mode };
    });
}

/**
 * Where a row lives, as a person reads it: the workspace, and its Org when
 * the person has more than one.
 * @param w - The workspace.
 * @param multiOrg - Whether to name the Org.
 */
export function placeLabel(w: Pick<ReachedWorkspace, 'name' | 'accountName'>, multiOrg: boolean): string {
  return multiOrg && w.accountName && w.accountName !== w.name ? `${w.name} · ${w.accountName}` : w.name;
}

/**
 * `query_state` from a Personal: the Personal's own records, then every
 * workspace it reaches in `full`, each row labelled with where it lives; and
 * for every workspace in a `counts` Org, only how many matched.
 * @param query - The query.
 * @param ctx - The Personal's own read context (its `orgIds` is the Personal).
 * @param run - The one-workspace reader (`runStateQuery`).
 * @param opts - Seams.
 * @param opts.reach - The person's reach, when already read.
 */
export async function personalStateRead(
  query: StateQuery,
  ctx: StateContext & { userId: string },
  run: (q: StateQuery, c: StateContext) => Promise<StateRead>,
  opts: { reach?: readonly ReachedOrg[] } = {},
): Promise<StateRead & { withheld: WithheldCount[] }> {
  const reach = opts.reach ?? await personalReach(ctx.userId);
  const workspaces = await reachedWorkspaces(ctx.userId, reach);
  const multiOrg = reach.length > 1;
  const own = await run(query, ctx);
  // The person's own access in each workspace: not the Personal agent's source narrowing.
  const others = await Promise.all(workspaces.map(async w => ({ w, read: await run(query, { ...ctx, orgIds: [w.id], allowedSourceSlugs: undefined }).catch(() => null) })));
  const rows = [...own.rows];
  const sources = new Map(own.sources.map(s => [s.slug, s]));
  let total = own.total;
  const withheld: WithheldCount[] = [];
  let missing = new Set(own.missing);
  for (const { w, read } of others) {
    if (!read) {
      continue;
    }
    missing = new Set([...missing].filter(m => read.missing.includes(m)));
    if (w.mode === 'counts') {
      if (read.total > 0) {
        withheld.push({ accountName: w.accountName, workspace: w.name, count: read.total, link: workspaceUrl(w.slug, '/dashboard/chat', { accountSlug: w.accountSlug, absolute: true }) });
      }
      continue;
    }
    total += read.total;
    const where = placeLabel(w, multiOrg);
    rows.push(...read.rows.map(r => ({ ...r, where })));
    for (const s of read.sources) {
      sources.set(`${s.slug}@${w.id}`, s);
    }
  }
  const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
  // Newest first across workspaces when no sort was asked for, as one list reads.
  const sorted = query.sort ? rows : [...rows].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
  return { rows: sorted.slice(0, limit), total, sources: [...sources.values()], missing: [...missing], withheld };
}
