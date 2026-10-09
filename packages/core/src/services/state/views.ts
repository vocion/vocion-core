/**
 * SAVED VIEWS — named, described state queries, kept as rows.
 *
 * "Owed replies", "stale deals", "PRs awaiting my review": each is a stored
 * `StateQuery` (`queryState.ts`) with a name and a sentence saying what it
 * shows, and an owner:
 *
 *   - `core`      — shipped with the product, from `libs/state/coreViews.json`
 *                   (data, seeded as rows the first time a view is read);
 *   - `org`       — one Org's, for every workspace in it;
 *   - `workspace` — one workspace's;
 *   - `person`    — one person's, in one workspace.
 *
 * The narrower owner wins for a slug, so a person's copy of a core view (with
 * their own Slack member id, or a longer window) replaces it for them alone.
 * Agents see the views in reach as named options (`query_state`), may run one
 * or compose their own query, and save a person's view when the person asks or
 * when a repeated question earns an offer (`learnViews.ts`).
 */
import type { StateQuery } from './queryState';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import coreViewsData from '@/libs/state/coreViews.json';
import { stateViewSchema } from '@/models/Schema';
import { checkQuery } from './queryState';

export type ViewScope = 'core' | 'org' | 'workspace' | 'person';

export type StateView = {
  id: number;
  scope: ViewScope;
  slug: string;
  name: string;
  description: string;
  query: StateQuery;
  inBrief: boolean;
};

type CoreView = { slug: string; name: string; description: string; query: StateQuery };

/** The core views as shipped, checked at load. */
export function coreViews(): CoreView[] {
  return (coreViewsData as { views: CoreView[] }).views;
}

let seeded = false;

/** Write the core views as rows, once per process; a changed file updates them. */
async function seedCoreViews(): Promise<void> {
  if (seeded) {
    return;
  }
  for (const v of coreViews()) {
    const [existing] = await db
      .select({ id: stateViewSchema.id })
      .from(stateViewSchema)
      .where(and(eq(stateViewSchema.scope, 'core'), eq(stateViewSchema.slug, v.slug)))
      .limit(1);
    if (existing) {
      await db.update(stateViewSchema).set({ name: v.name, description: v.description, query: v.query as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(stateViewSchema.id, existing.id));
    } else {
      await db.insert(stateViewSchema).values({ scope: 'core', slug: v.slug, name: v.name, description: v.description, query: v.query as unknown as Record<string, unknown>, createdBy: 'core' });
    }
  }
  seeded = true;
}

const NARROWNESS: Record<ViewScope, number> = { core: 0, org: 1, workspace: 2, person: 3 };

/**
 * The views a person sees in a workspace, one per slug, the narrowest owner
 * winning.
 * @param where - Whose and where.
 * @param where.orgId - The workspace.
 * @param where.accountId - Its Org, when known.
 * @param where.userId - The person, when there is one.
 */
export async function viewsFor(where: { orgId: string; accountId?: string | null; userId?: string | null }): Promise<StateView[]> {
  await seedCoreViews();
  const rows = await db
    .select()
    .from(stateViewSchema)
    .where(or(
      eq(stateViewSchema.scope, 'core'),
      ...(where.accountId ? [and(eq(stateViewSchema.scope, 'org'), eq(stateViewSchema.accountId, where.accountId))] : []),
      and(eq(stateViewSchema.scope, 'workspace'), eq(stateViewSchema.orgId, where.orgId)),
      ...(where.userId ? [and(eq(stateViewSchema.scope, 'person'), eq(stateViewSchema.orgId, where.orgId), eq(stateViewSchema.userId, where.userId))] : []),
    ));
  const bySlug = new Map<string, StateView>();
  for (const r of rows) {
    const view: StateView = { id: r.id, scope: r.scope, slug: r.slug, name: r.name, description: r.description, query: r.query as unknown as StateQuery, inBrief: r.inBrief };
    const held = bySlug.get(r.slug);
    if (!held || NARROWNESS[view.scope] > NARROWNESS[held.scope]) {
      bySlug.set(r.slug, view);
    }
  }
  return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * One view by slug, as this person sees it.
 * @param slug - The view.
 * @param where - Whose and where.
 * @param where.orgId - The workspace.
 * @param where.accountId - Its Org.
 * @param where.userId - The person.
 */
export async function viewBySlug(slug: string, where: { orgId: string; accountId?: string | null; userId?: string | null }): Promise<StateView | undefined> {
  return (await viewsFor(where)).find(v => v.slug === slug);
}

/**
 * A slug from a name: lowercase words joined by hyphens.
 * @param name - The view's name.
 */
export function slugFor(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'view';
}

export type SaveView = {
  orgId: string;
  userId: string;
  name: string;
  description: string;
  query: StateQuery;
  slug?: string;
  inBrief?: boolean;
  /** `agent` when an agent saved it on the person's word or their approval. */
  createdBy: string;
};

/**
 * Save (or replace) a person's view. The query is checked first, so a view
 * that cannot run is never stored. Returns the view and what it replaced.
 * @param v - The view.
 */
export async function savePersonView(v: SaveView): Promise<{ view: StateView; previous: StateView | null }> {
  const problems = checkQuery(v.query);
  if (problems.length > 0) {
    throw new Error(`That view cannot run: ${problems.map(p => p.message).join('; ')}.`);
  }
  const slug = v.slug ?? slugFor(v.name);
  const [prior] = await db
    .select()
    .from(stateViewSchema)
    .where(and(eq(stateViewSchema.scope, 'person'), eq(stateViewSchema.orgId, v.orgId), eq(stateViewSchema.userId, v.userId), eq(stateViewSchema.slug, slug)))
    .limit(1);
  const values = { name: v.name, description: v.description, query: v.query as unknown as Record<string, unknown>, inBrief: v.inBrief ?? false, updatedAt: new Date() };
  const [row] = prior
    ? await db.update(stateViewSchema).set(values).where(eq(stateViewSchema.id, prior.id)).returning()
    : await db.insert(stateViewSchema).values({ ...values, scope: 'person', orgId: v.orgId, userId: v.userId, slug, createdBy: v.createdBy }).returning();
  const toView = (r: typeof stateViewSchema.$inferSelect): StateView => ({ id: r.id, scope: r.scope, slug: r.slug, name: r.name, description: r.description, query: r.query as unknown as StateQuery, inBrief: r.inBrief });
  return { view: toView(row!), previous: prior ? toView(prior) : null };
}

/**
 * Remove a person's view (undo of a save that created it).
 * @param id - The view's row id.
 * @param userId - Its owner; nothing else is removed.
 */
export async function deletePersonView(id: number, userId: string): Promise<void> {
  await db.delete(stateViewSchema).where(and(eq(stateViewSchema.id, id), eq(stateViewSchema.scope, 'person'), eq(stateViewSchema.userId, userId)));
}

/**
 * The person's views marked for their brief, in the workspaces given.
 * @param userId - The person.
 * @param orgIds - Their workspaces.
 */
export async function briefViews(userId: string, orgIds: string[]): Promise<Array<StateView & { orgId: string }>> {
  if (orgIds.length === 0) {
    return [];
  }
  const rows = await db
    .select()
    .from(stateViewSchema)
    .where(and(eq(stateViewSchema.scope, 'person'), eq(stateViewSchema.userId, userId), eq(stateViewSchema.inBrief, true), inArray(stateViewSchema.orgId, orgIds), isNull(stateViewSchema.accountId)));
  return rows.map(r => ({ id: r.id, scope: r.scope, slug: r.slug, name: r.name, description: r.description, query: r.query as unknown as StateQuery, inBrief: r.inBrief, orgId: r.orgId! }));
}

/** Test seam: forget that core views were seeded (each test file has its own database). */
export function resetCoreViewSeed(): void {
  seeded = false;
}
