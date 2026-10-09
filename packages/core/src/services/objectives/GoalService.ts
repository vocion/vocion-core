/**
 * GOALS — made, read, measured, linked and moved (`libs/objectives/goal.ts`).
 *
 * A goal is the objective noun past one conversation: one row per goal
 * (`goal`, migration 0209), owned by one person in one home workspace. Every
 * read is keyed on the workspace (`org_id`); every write on the workspace AND
 * the owner, so nobody moves another person's goal, and nothing crosses a
 * workspace it was not made in.
 *
 * Progress is never stored as the truth. A view measure is counted live from
 * the index each time it is read (`services/state/state.ts`); milestones
 * linked to work are read against that work. What the row keeps is the last
 * reading (`last_done` / `last_total`) and when it last moved
 * (`progress_at`), so a line can be said without measuring again and a goal
 * that has gone quiet can be noticed.
 *
 * A goal is never made silently: `goal.create` (`libs/actions/goal-create.ts`)
 * is the only caller of {@link createGoal}, and it runs on the person's
 * approval of the Decision the agent drafted.
 */

import type { Goal, GoalActivity, GoalHorizon, GoalLink, GoalMeasure, GoalProgress, GoalStatus, LinkState, Milestone, NextStep } from '@/libs/objectives/goal';
import type { ObjectiveView } from '@/libs/objectives/objective';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { completeFromLinks, linkKey, measureProblem, milestoneProgress, setMilestone, viewProgress, withActivity } from '@/libs/objectives/goal';
import { goalObjectiveView } from '@/libs/objectives/objective';
import { artifactSchema, businessObjectSchema, conversationSchema, goalSchema, projectSchema, userSchema } from '@/models/Schema';

/** Why a goal write was refused, said for a person. */
export class GoalError extends Error {}

type Row = typeof goalSchema.$inferSelect;

/**
 * A row as the goal it is.
 * @param r - The row.
 */
export function goalOf(r: Row): Goal {
  return {
    id: r.id,
    orgId: r.orgId,
    accountId: r.accountId,
    ownerUserId: r.ownerUserId,
    title: r.title,
    horizon: r.horizon,
    status: r.status,
    measure: r.measure,
    links: r.links ?? [],
    cadence: r.cadence ?? null,
    nextSteps: r.nextSteps ?? [],
    activity: r.activity ?? [],
    lastDone: r.lastDone,
    lastTotal: r.lastTotal,
    progressAt: r.progressAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Record statuses that mean the work is finished. */
const FINISHED = new Set(['done', 'complete', 'completed', 'closed', 'won', 'shipped', 'published', 'resolved', 'delivered', 'signed']);

export type CreateGoal = {
  orgId: string;
  ownerUserId: string;
  title: string;
  horizon: GoalHorizon;
  measure: GoalMeasure;
  links?: GoalLink[];
  cadence?: 'weekly' | null;
  nextSteps?: NextStep[];
  /** `agent`, or the person's id. */
  createdBy: string;
  /** The conversation it was made in, which then works on it. */
  conversationId?: number | null;
  now?: Date;
};

/**
 * Make a goal. The home workspace must be one the owner can work in; the
 * measure must be one that can be kept. The conversation it was made in
 * starts working on it (its objective), unless that conversation is in the
 * middle of a setup, which is left exactly as it is.
 * @param input - The goal.
 */
export async function createGoal(input: CreateGoal): Promise<Goal> {
  const problem = measureProblem(input.measure);
  if (problem) {
    throw new GoalError(problem);
  }
  const title = input.title.trim();
  if (title.length < 3) {
    throw new GoalError('A goal needs a title a person would recognise.');
  }
  const [project] = await db.select({ accountId: projectSchema.accountId }).from(projectSchema).where(eq(projectSchema.id, input.orgId)).limit(1);
  if (!project) {
    throw new GoalError('That workspace no longer exists.');
  }
  const now = input.now ?? new Date();
  const [row] = await db.insert(goalSchema).values({
    orgId: input.orgId,
    accountId: project.accountId,
    ownerUserId: input.ownerUserId,
    title: title.slice(0, 200),
    horizon: input.horizon,
    measure: input.measure,
    links: dedupeLinks(input.links ?? []),
    cadence: input.cadence ?? null,
    nextSteps: (input.nextSteps ?? []).slice(0, 3),
    activity: [{ at: now.toISOString(), what: 'Goal set', by: input.createdBy }],
    createdBy: input.createdBy,
    createdFrom: input.conversationId ?? null,
    createdAt: now,
    updatedAt: now,
  }).returning();
  const goal = goalOf(row!);
  if (input.conversationId) {
    await workOnGoalIn(input.orgId, input.conversationId, goal.id, now);
  }
  return goal;
}

/**
 * Point a conversation at a goal as its objective — unless it is walking a
 * setup, which keeps the line it has.
 * @param orgId - The workspace.
 * @param conversationId - The conversation.
 * @param goalId - The goal.
 * @param now - The clock.
 */
export async function workOnGoalIn(orgId: string, conversationId: number, goalId: number, now: Date = new Date()): Promise<void> {
  const [row] = await db.select({ objective: conversationSchema.objective }).from(conversationSchema).where(and(eq(conversationSchema.orgId, orgId), eq(conversationSchema.id, conversationId))).limit(1);
  if (!row) {
    return;
  }
  const { readObjective } = await import('@/libs/objectives/objective');
  const was = readObjective(row.objective);
  if (was?.kind === 'setup' && was.state === 'running') {
    return;
  }
  if (was?.kind === 'goal' && was.goalId === goalId && was.state === 'running') {
    return;
  }
  await db.update(conversationSchema)
    .set({ objective: { kind: 'goal', goalId, state: 'running', startedAt: now.toISOString() } })
    .where(and(eq(conversationSchema.orgId, orgId), eq(conversationSchema.id, conversationId)));
}

/**
 * One goal in this workspace, or null.
 * @param orgId - The workspace.
 * @param id - The goal.
 */
export async function getGoal(orgId: string, id: number): Promise<Goal | null> {
  const [row] = await db.select().from(goalSchema).where(and(eq(goalSchema.orgId, orgId), eq(goalSchema.id, id))).limit(1);
  return row ? goalOf(row) : null;
}

/**
 * Goals in a workspace, newest first: one person's, or everyone's.
 * @param where - Which.
 * @param where.orgId - The workspace.
 * @param where.ownerUserId - Only this person's.
 * @param where.statuses - Only these statuses.
 */
export async function listGoals(where: { orgId: string; ownerUserId?: string; statuses?: readonly GoalStatus[] }): Promise<Goal[]> {
  const rows = await db
    .select()
    .from(goalSchema)
    .where(and(
      eq(goalSchema.orgId, where.orgId),
      ...(where.ownerUserId ? [eq(goalSchema.ownerUserId, where.ownerUserId)] : []),
      ...(where.statuses ? [inArray(goalSchema.status, [...where.statuses])] : []),
    ))
    .orderBy(sql`case ${goalSchema.status} when 'active' then 0 when 'paused' then 1 when 'done' then 2 else 3 end`, desc(goalSchema.updatedAt))
    .limit(200);
  return rows.map(goalOf);
}

/**
 * How many goals this person has active: in one workspace, or — for their
 * Personal — everywhere they own one. The sidebar's count; one SQL count.
 * @param where - Whose and where.
 * @param where.userId - The person.
 * @param where.orgId - The workspace; omit to count across all of theirs.
 */
export async function activeGoalCount(where: { userId: string; orgId?: string }): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(goalSchema)
    .where(and(eq(goalSchema.ownerUserId, where.userId), eq(goalSchema.status, 'active'), ...(where.orgId ? [eq(goalSchema.orgId, where.orgId)] : [])));
  return Number(row?.n ?? 0);
}

/** A goal write: who is asking, so only the owner moves their goal. */
export type GoalActor = { userId: string; by: 'agent' | 'person' };

/**
 * The goal, refused unless this person owns it.
 * @param orgId - The workspace.
 * @param id - The goal.
 * @param actor - Who is writing.
 */
async function ownGoal(orgId: string, id: number, actor: GoalActor): Promise<Goal> {
  const goal = await getGoal(orgId, id);
  if (!goal) {
    throw new GoalError(`No GOAL-${id} in this workspace.`);
  }
  if (goal.ownerUserId !== actor.userId) {
    throw new GoalError(`GOAL-${id} is someone else's goal; only its owner changes it.`);
  }
  return goal;
}

const who = (actor: GoalActor) => (actor.by === 'agent' ? 'agent' : actor.userId);

async function save(goal: Goal, patch: Partial<Row>, now: Date): Promise<Goal> {
  const [row] = await db.update(goalSchema)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(goalSchema.orgId, goal.orgId), eq(goalSchema.id, goal.id), eq(goalSchema.ownerUserId, goal.ownerUserId)))
    .returning();
  return goalOf(row!);
}

export type GoalPatch = {
  title?: string;
  horizon?: GoalHorizon;
  status?: GoalStatus;
  cadence?: 'weekly' | null;
  nextSteps?: NextStep[];
  /** Replace the milestones (the agent's re-plan); done ones keep their state by key. */
  milestones?: Array<{ label: string; link?: GoalLink }>;
};

/**
 * Change a goal: its title, horizon, status, cadence, next steps or its
 * milestones. A view measure's progress is not a field: it is counted.
 * @param orgId - The workspace.
 * @param id - The goal.
 * @param actor - Who.
 * @param patch - What changes.
 * @param now - The clock.
 */
export async function updateGoal(orgId: string, id: number, actor: GoalActor, patch: GoalPatch, now: Date = new Date()): Promise<Goal> {
  const goal = await ownGoal(orgId, id, actor);
  const set: Partial<Row> = {};
  const said: string[] = [];
  if (patch.title !== undefined && patch.title.trim() && patch.title.trim() !== goal.title) {
    set.title = patch.title.trim().slice(0, 200);
    said.push(`Renamed to “${set.title}”`);
  }
  if (patch.horizon) {
    set.horizon = patch.horizon;
    said.push('Horizon moved');
  }
  if (patch.status && patch.status !== goal.status) {
    set.status = patch.status;
    said.push({ active: 'Resumed', paused: 'Paused', done: 'Marked done', dropped: 'Dropped' }[patch.status]);
  }
  if (patch.cadence !== undefined && patch.cadence !== goal.cadence) {
    set.cadence = patch.cadence;
    said.push(patch.cadence ? 'Weekly review on' : 'Weekly review off');
  }
  if (patch.nextSteps) {
    set.nextSteps = patch.nextSteps.slice(0, 3);
  }
  if (patch.milestones) {
    if (goal.measure.kind !== 'milestones') {
      throw new GoalError('This goal is measured by a view; it has no milestones to re-plan.');
    }
    const kept = new Map(goal.measure.milestones.map(m => [m.label.toLowerCase(), m]));
    const milestones: Milestone[] = patch.milestones.map((m, i) => {
      const was = kept.get(m.label.trim().toLowerCase());
      return was ? { ...was, key: `m${i + 1}`, ...(m.link ? { link: m.link } : {}) } : { key: `m${i + 1}`, label: m.label.trim(), done: false, ...(m.link ? { link: m.link } : {}) };
    });
    const measure: GoalMeasure = { kind: 'milestones', milestones };
    const problem = measureProblem(measure);
    if (problem) {
      throw new GoalError(problem);
    }
    set.measure = measure;
    said.push('Milestones re-planned');
  }
  if (Object.keys(set).length === 0) {
    return goal;
  }
  set.activity = said.reduce<GoalActivity[]>((a, what) => withActivity(a, { at: now.toISOString(), what, by: who(actor) }), goal.activity);
  return save(goal, set, now);
}

/**
 * Two links are one when they name the same thing.
 * @param links - Links, maybe repeated.
 */
function dedupeLinks(links: readonly GoalLink[]): GoalLink[] {
  const seen = new Set<string>();
  return links.filter(l => !seen.has(linkKey(l)) && (seen.add(linkKey(l)), true)).slice(0, 40);
}

/**
 * Link work to a goal (or unlink it). Each link must be something in this
 * workspace the owner can open; one that is not is refused by name.
 * @param orgId - The workspace.
 * @param id - The goal.
 * @param actor - Who.
 * @param change - What to add and remove.
 * @param change.add - Links to add.
 * @param change.remove - Links to remove.
 * @param now - The clock.
 */
export async function linkGoal(orgId: string, id: number, actor: GoalActor, change: { add?: GoalLink[]; remove?: GoalLink[] }, now: Date = new Date()): Promise<Goal> {
  const goal = await ownGoal(orgId, id, actor);
  const add = change.add ?? [];
  if (add.length > 0) {
    const found = await resolveGoalLinks(orgId, actor.userId, add);
    const missing = add.filter(l => !found.some(f => linkKey(f) === linkKey(l)));
    if (missing.length > 0) {
      throw new GoalError(`Not found in this workspace: ${missing.map(linkKey).join(', ')}. Link only what is here.`);
    }
    add.splice(0, add.length, ...found.map(f => ({ kind: f.kind, id: f.id, label: f.label ?? f.title })));
  }
  const removed = new Set((change.remove ?? []).map(linkKey));
  const links = dedupeLinks([...goal.links.filter(l => !removed.has(linkKey(l))), ...add]);
  const said = [
    ...add.map(l => `Linked ${l.kind} “${l.label ?? l.id}”`),
    ...(change.remove ?? []).filter(l => goal.links.some(g => linkKey(g) === linkKey(l))).map(l => `Unlinked ${l.kind} ${l.id}`),
  ];
  return save(goal, { links, activity: said.reduce<GoalActivity[]>((a, what) => withActivity(a, { at: now.toISOString(), what, by: who(actor) }), goal.activity) }, now);
}

/**
 * Mark a milestone done or open. The agent needs evidence and never moves one
 * the person set; the person's own tick always wins.
 * @param orgId - The workspace.
 * @param id - The goal.
 * @param actor - Who.
 * @param key - The milestone.
 * @param done - Done or not.
 * @param evidence - What shows it (the agent's).
 * @param now - The clock.
 */
export async function setGoalMilestone(orgId: string, id: number, actor: GoalActor, key: string, done: boolean, evidence?: string, now: Date = new Date()): Promise<Goal> {
  const goal = await ownGoal(orgId, id, actor);
  if (goal.measure.kind !== 'milestones') {
    throw new GoalError('This goal is measured by a view: its progress is counted from the view, never ticked by hand.');
  }
  const out = setMilestone(goal.measure.milestones, key, done, who(actor), now, evidence);
  if (out.refused) {
    throw new GoalError(out.refused);
  }
  if (!out.changed) {
    return goal;
  }
  const label = out.milestones.find(m => m.key === key)!.label;
  const progress = milestoneProgress(out.milestones);
  return save(goal, {
    measure: { kind: 'milestones', milestones: out.milestones },
    lastDone: progress.done,
    lastTotal: progress.total,
    ...(done ? { progressAt: now } : {}),
    activity: withActivity(goal.activity, { at: now.toISOString(), what: `${done ? 'Done' : 'Reopened'}: ${label}`, by: who(actor) }),
  }, now);
}

/** A link with what it is called now and where it opens. */
export type ResolvedLink = GoalLink & { title: string; href: string };

/**
 * Each link's live title and link, as this person sees it in this workspace.
 * Links to things that are gone or out of reach are left out — never shown
 * with a stale name. Mirrors the pin resolver's reads (`feat/pin-favorites`):
 * when pins land, both read through one resolver.
 * @param orgId - The workspace.
 * @param viewerId - The person.
 * @param links - The links.
 */
export async function resolveGoalLinks(orgId: string, viewerId: string, links: readonly GoalLink[]): Promise<ResolvedLink[]> {
  const ids = (kind: GoalLink['kind']) => links.filter(l => l.kind === kind).map(l => l.id);
  const nums = (kind: GoalLink['kind']) => ids(kind).map(Number).filter(n => Number.isSafeInteger(n) && n > 0);
  const found = new Map<string, ResolvedLink>();
  const put = (l: GoalLink, title: string, href: string) => found.set(linkKey(l), { ...l, title: title.trim() || 'Untitled', href });
  const safely = async (read: () => Promise<void>) => {
    try {
      await read();
    } catch (error) {
      console.warn('goals: could not read one kind of link', error);
    }
  };
  await Promise.all([
    safely(async () => {
      const wanted = nums('conversation');
      if (wanted.length === 0) {
        return;
      }
      const rows = await db.select({ id: conversationSchema.id, title: conversationSchema.title, createdBy: conversationSchema.createdBy }).from(conversationSchema).where(and(eq(conversationSchema.orgId, orgId), inArray(conversationSchema.id, wanted)));
      rows.forEach(r => put({ kind: 'conversation', id: String(r.id) }, r.title, `/dashboard/chat/${r.id}`));
    }),
    safely(async () => {
      const wanted = nums('artifact');
      if (wanted.length === 0) {
        return;
      }
      const { canOpenArtifact } = await import('@/libs/share/audience');
      const rows = await db.select({ id: artifactSchema.id, title: artifactSchema.title, audience: artifactSchema.shareAudience, ownerId: artifactSchema.shareOwnerId }).from(artifactSchema).where(and(eq(artifactSchema.orgId, orgId), inArray(artifactSchema.id, wanted)));
      rows.filter(r => canOpenArtifact({ audience: r.audience, ownerId: r.ownerId ?? null }, { userId: viewerId, isMember: true, hasToken: false }))
        .forEach(r => put({ kind: 'artifact', id: String(r.id) }, r.title, `/dashboard/artifacts/${r.id}`));
    }),
    safely(async () => {
      const wanted = [...new Set([...nums('room'), ...nums('record')])];
      if (wanted.length === 0) {
        return;
      }
      const { businessObjectTypeSchema } = await import('@/models/Schema');
      const rows = await db
        .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, type: businessObjectTypeSchema.slug })
        .from(businessObjectSchema)
        .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
        .where(and(eq(businessObjectSchema.orgId, orgId), inArray(businessObjectSchema.id, wanted)));
      const [{ DATA_ROOM_TYPE, roomHref }, { recordHref }] = await Promise.all([import('@/services/DataRoomService'), import('@/services/objects/recordHref')]);
      const rooms = new Set(ids('room'));
      const records = new Set(ids('record'));
      for (const r of rows) {
        if (rooms.has(String(r.id)) && r.type === DATA_ROOM_TYPE) {
          put({ kind: 'room', id: String(r.id) }, r.title, roomHref(r.id));
        }
        if (records.has(String(r.id))) {
          put({ kind: 'record', id: String(r.id) }, r.title, r.type === DATA_ROOM_TYPE ? roomHref(r.id) : await recordHref(orgId, { objectType: r.type, id: r.id }).catch(() => `/dashboard/objects/${r.id}`));
        }
      }
    }),
    safely(async () => {
      const wanted = ids('view');
      if (wanted.length === 0) {
        return;
      }
      const { viewsFor } = await import('@/services/state/state');
      for (const v of (await viewsFor({ orgId, userId: viewerId })).filter(x => wanted.includes(x.slug))) {
        put({ kind: 'view', id: v.slug }, v.name, `/dashboard/chat?ask=${encodeURIComponent(`Show my "${v.name}" view`)}`);
      }
    }),
    safely(async () => {
      for (const id of ids('wiki')) {
        const [page, slug] = id.split('/');
        if (!page || !slug) {
          continue;
        }
        const { readPageForOrg } = await import('@/services/PluginService');
        const manifest = await readPageForOrg(page, orgId);
        const folder = manifest?.archetype === 'wiki' && manifest.source?.kind === 'artifacts' ? manifest.source.folder : null;
        if (!folder) {
          continue;
        }
        const { loadWikiReadingPages } = await import('@/services/wiki/wikiReading');
        const p = (await loadWikiReadingPages(orgId, folder)).find(x => x.slug === slug);
        if (p) {
          put({ kind: 'wiki', id }, p.title, `/dashboard/p/${page}/${p.slug}`);
        }
      }
    }),
  ]);
  return links.map(l => found.get(linkKey(l))).filter((l): l is ResolvedLink => !!l).map(l => ({ ...l, label: links.find(x => linkKey(x) === linkKey(l))?.label ?? l.title }));
}

/**
 * Where each milestone's linked work stands: a record finished, an artifact
 * or wiki page written, a view emptied. A conversation never completes one.
 * @param goal - The goal.
 */
async function linkStates(goal: Goal): Promise<Map<string, LinkState>> {
  const out = new Map<string, LinkState>();
  if (goal.measure.kind !== 'milestones') {
    return out;
  }
  const links = goal.measure.milestones.filter(m => m.link && !m.done && !m.locked).map(m => m.link!);
  if (links.length === 0) {
    return out;
  }
  const records = links.filter(l => l.kind === 'record' || l.kind === 'room').map(l => Number(l.id)).filter(n => Number.isSafeInteger(n) && n > 0);
  if (records.length > 0) {
    const rows = await db.select({ id: businessObjectSchema.id, status: businessObjectSchema.status }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, goal.orgId), inArray(businessObjectSchema.id, records)));
    for (const r of rows) {
      const state: LinkState = FINISHED.has(String(r.status ?? '').toLowerCase()) ? 'complete' : 'open';
      out.set(`record:${r.id}`, state);
      out.set(`room:${r.id}`, state);
    }
  }
  const written = links.filter(l => l.kind === 'artifact' || l.kind === 'wiki');
  if (written.length > 0) {
    for (const l of await resolveGoalLinks(goal.orgId, goal.ownerUserId, written)) {
      out.set(linkKey(l), 'complete');
    }
  }
  for (const l of links.filter(x => x.kind === 'view')) {
    const counts = await viewCounts(goal, { kind: 'view', view: l.id, target: 1 }).catch(() => null);
    out.set(linkKey(l), counts && !counts.missing && counts.total === 0 ? 'complete' : 'open');
  }
  return out;
}

/** What a view measure read off the index. */
type ViewCounts = { total: number; done: number; viewName: string | null; missing?: string };

/**
 * Count a view for a goal: its rows, and those matching the done facets. Read
 * with the owner's own reach, in the goal's home workspace (and, from a
 * Personal, across their Orgs as Personal reads).
 * @param goal - The goal.
 * @param measure - The view measure.
 */
async function viewCounts(goal: Goal, measure: Extract<GoalMeasure, { kind: 'view' }>): Promise<ViewCounts> {
  const [{ checkQuery, runStateQuery, viewBySlug }, { handlesOf }] = await Promise.all([import('@/services/state/state'), import('@/libs/retrieval/facets')]);
  const view = await viewBySlug(measure.view, { orgId: goal.orgId, accountId: goal.accountId, userId: goal.ownerUserId });
  if (!view) {
    return { total: 0, done: 0, viewName: null, missing: `The view "${measure.view}" is not there any more.` };
  }
  const [person] = await db.select({ email: userSchema.email, name: userSchema.name }).from(userSchema).where(eq(userSchema.id, goal.ownerUserId)).limit(1);
  const [project] = await db.select({ kind: projectSchema.kind }).from(projectSchema).where(eq(projectSchema.id, goal.orgId)).limit(1);
  const ctx = { orgIds: [goal.orgId], userId: goal.ownerUserId, me: person ? handlesOf(person) : [], now: new Date() };
  const run = async (filter: Record<string, unknown> | undefined) => {
    const query = { ...view.query, ...(filter ? { filter: filter as never } : {}), limit: 1 };
    if (checkQuery(query).length > 0) {
      throw new GoalError(`The view "${view.name}" with those done facets cannot run: ${checkQuery(query).map(p => p.message).join('; ')}.`);
    }
    if (project?.kind === 'personal') {
      const { personalStateRead } = await import('@/services/personal/acrossOrgs');
      return personalStateRead(query, ctx, runStateQuery);
    }
    return runStateQuery(query, ctx);
  };
  const all = await run(view.query.filter as Record<string, unknown> | undefined);
  const done = measure.done && Object.keys(measure.done).length > 0 ? await run({ ...(view.query.filter ?? {}), ...measure.done }) : null;
  return { total: all.total, done: done?.total ?? 0, viewName: view.name, ...(all.missing.length > 0 && all.total === 0 ? { missing: `Nothing connected here carries ${all.missing.join(', ')}.` } : {}) };
}

/** A goal read now: where it stands, and what its view is called. */
export type MeasuredGoal = { goal: Goal; progress: GoalProgress; viewName: string | null };

/**
 * Measure a goal now: count its view, or read its milestones' linked work and
 * mark the ones that completed. When progress moved, the row says so — the
 * reading, when it moved, and one activity line — so the stall clock and
 * "what moved" stay true without anyone ticking anything.
 * @param goal - The goal.
 * @param opts - Seams.
 * @param opts.now - The clock.
 * @param opts.persist - Write a move back (default true).
 */
export async function measureGoal(goal: Goal, opts: { now?: Date; persist?: boolean } = {}): Promise<MeasuredGoal> {
  const now = opts.now ?? new Date();
  let progress: GoalProgress;
  let viewName: string | null = null;
  const patch: Partial<Row> = {};
  if (goal.measure.kind === 'view') {
    const counts = await viewCounts(goal, goal.measure).catch((error: unknown) => ({ total: 0, done: 0, viewName: null, missing: error instanceof Error ? error.message : 'The view could not be read.' } as ViewCounts));
    viewName = counts.viewName;
    progress = counts.missing
      ? { done: goal.lastDone ?? 0, total: goal.lastTotal ?? 0, ratio: null, label: goal.lastTotal ? `${goal.lastDone ?? 0} of ${goal.lastTotal} (last read)` : 'not measured yet', unmeasured: counts.missing }
      : viewProgress(goal.measure, counts);
  } else {
    const states = await linkStates(goal).catch(() => new Map<string, LinkState>());
    const milestones = completeFromLinks(goal.measure.milestones, states, now);
    if (milestones !== goal.measure.milestones) {
      patch.measure = { kind: 'milestones', milestones };
      const newly = milestones.filter((m, i) => m.done && !(goal.measure as { milestones: Milestone[] }).milestones[i]!.done);
      patch.activity = newly.reduce<GoalActivity[]>((a, m) => withActivity(a, { at: now.toISOString(), what: `Done: ${m.label} (linked ${m.link?.kind} completed)`, by: 'agent' }), goal.activity);
    }
    progress = milestoneProgress(milestones);
  }
  if (!progress.unmeasured && (progress.done !== goal.lastDone || progress.total !== goal.lastTotal)) {
    patch.lastDone = progress.done;
    patch.lastTotal = progress.total;
    if (goal.lastDone !== null && progress.done > goal.lastDone) {
      patch.progressAt = now;
      if (goal.measure.kind === 'view') {
        patch.activity = withActivity(patch.activity ?? goal.activity, { at: now.toISOString(), what: `${progress.label} (+${progress.done - goal.lastDone})`, by: 'measure' });
      }
    }
    if (goal.lastDone === null && progress.done > 0) {
      patch.progressAt = now;
    }
  }
  let saved = goal;
  if (opts.persist !== false && Object.keys(patch).length > 0) {
    saved = await save(goal, patch, goal.updatedAt).catch(() => ({ ...goal, ...patch } as Goal));
  }
  return { goal: saved, progress, viewName };
}

/**
 * A conversation's goal objective, as the strip draws it.
 * @param orgId - The workspace.
 * @param conversationId - The conversation.
 * @param objective - What the row keeps.
 * @param objective.kind
 * @param objective.goalId - The goal.
 * @param objective.state - Running or stopped.
 * @param objective.startedAt - When.
 */
export async function goalObjective(orgId: string, conversationId: number, objective: { kind: 'goal'; goalId: number; state: 'running' | 'stopped'; startedAt: string }): Promise<ObjectiveView | null> {
  const goal = await getGoal(orgId, objective.goalId);
  if (!goal) {
    return null;
  }
  const { progress } = await measureGoal(goal);
  const milestones = goal.measure.kind === 'milestones' ? goal.measure.milestones.map(m => ({ key: m.key, label: m.label, done: m.done })) : [];
  return goalObjectiveView(conversationId, objective, { title: goal.title, status: goal.status, milestones, progress });
}

/**
 * What the lead is told about this person's goals at the top of a turn: the
 * active ones here (in a Personal, everywhere they own one), each in one line
 * from the last reading — no measuring on the turn's clock. Empty when there
 * are none.
 * @param input - Whose and where.
 * @param input.orgId - The workspace.
 * @param input.userId - The person.
 * @param input.personal - The workspace is their Personal.
 */
export async function goalsTurnNote(input: { orgId: string; userId: string; personal: boolean }): Promise<string> {
  const rows = await db
    .select({ id: goalSchema.id, title: goalSchema.title, horizon: goalSchema.horizon, measure: goalSchema.measure, lastDone: goalSchema.lastDone, lastTotal: goalSchema.lastTotal, workspace: projectSchema.name })
    .from(goalSchema)
    .innerJoin(projectSchema, eq(projectSchema.id, goalSchema.orgId))
    .where(and(eq(goalSchema.ownerUserId, input.userId), eq(goalSchema.status, 'active'), ...(input.personal ? [] : [eq(goalSchema.orgId, input.orgId)])))
    .orderBy(desc(goalSchema.updatedAt))
    .limit(6);
  if (rows.length === 0) {
    return '';
  }
  const { horizonLabel } = await import('@/libs/objectives/goal');
  const lines = rows.map((r) => {
    const where = r.lastTotal !== null ? `${r.lastDone ?? 0} of ${r.lastTotal}` : r.measure.kind === 'milestones' ? `${r.measure.milestones.filter(m => m.done).length} of ${r.measure.milestones.length} milestones` : 'not measured yet';
    return `- GOAL-${r.id} ${r.title} · ${where} · ${horizonLabel(r.horizon)}${input.personal ? ` · ${r.workspace}` : ''}`;
  });
  return [`THE PERSON'S ACTIVE GOALS${input.personal ? '' : ' HERE'} (context, not a task list — bring one up only when this turn bears on it; goal_progress reads one live):`, ...lines].join('\n');
}

/** A goal as Personal lists it: with where it lives. */
export type PlacedGoal = Goal & { workspace: { id: string; slug: string; name: string; accountName: string; accountSlug: string; personal: boolean }; href: string };

/** An Org that keeps its items out of Personal: how many of the person's goals are there, and the door. */
export type WithheldGoals = { accountName: string; workspace: string; count: number; link: string };

/**
 * "Your goals" — every goal this person owns, across the workspaces their one
 * Personal reaches (`services/personal/reach.ts`), plus Personal's own. Each
 * carries its workspace and Org, to label it. An Org read in `counts` mode
 * gives a number and a link, never the goals' titles. Read with the person's
 * own access: a workspace they left is not read.
 * @param userId - The person.
 * @param opts - Seams and narrowing.
 * @param opts.statuses - Only these statuses.
 * @param opts.reach - Their reach, when already read.
 */
export async function personalGoals(userId: string, opts: { statuses?: readonly GoalStatus[]; reach?: readonly import('@/services/personal/reach').ReachedOrg[] } = {}): Promise<{ goals: PlacedGoal[]; withheld: WithheldGoals[] }> {
  const [{ personalReach }, { reachedWorkspaces }, { findPersonalProject }, { workspaceUrl }] = await Promise.all([
    import('@/services/personal/reach'),
    import('@/services/personal/acrossOrgs'),
    import('@/services/workspace/personalProject'),
    import('@/libs/links'),
  ]);
  const reach = opts.reach ?? await personalReach(userId);
  const shared = await reachedWorkspaces(userId, reach);
  const personal = await findPersonalProject(userId);
  const home = reach.find(r => r.home) ?? reach[0];
  const places = [
    ...(personal ? [{ id: personal.id, slug: personal.slug, name: 'Personal', accountId: personal.accountId, accountName: home?.name ?? '', accountSlug: home?.slug ?? '', mode: 'full' as const, personal: true }] : []),
    ...shared.map(w => ({ ...w, personal: false })),
  ];
  if (places.length === 0) {
    return { goals: [], withheld: [] };
  }
  const rows = await db
    .select()
    .from(goalSchema)
    .where(and(eq(goalSchema.ownerUserId, userId), inArray(goalSchema.orgId, places.map(p => p.id)), ...(opts.statuses ? [inArray(goalSchema.status, [...opts.statuses])] : [])))
    .orderBy(sql`case ${goalSchema.status} when 'active' then 0 when 'paused' then 1 when 'done' then 2 else 3 end`, desc(goalSchema.updatedAt))
    .limit(300);
  const byId = new Map(places.map(p => [p.id, p]));
  const goals: PlacedGoal[] = [];
  const counted = new Map<string, WithheldGoals>();
  for (const r of rows) {
    const p = byId.get(r.orgId)!;
    if (p.mode === 'counts') {
      const held = counted.get(p.id) ?? { accountName: p.accountName, workspace: p.name, count: 0, link: workspaceUrl(p.slug, '/dashboard/goals', { accountSlug: p.accountSlug }) };
      held.count += 1;
      counted.set(p.id, held);
      continue;
    }
    goals.push({
      ...goalOf(r),
      workspace: { id: p.id, slug: p.slug, name: p.name, accountName: p.accountName, accountSlug: p.accountSlug, personal: p.personal },
      href: workspaceUrl(p.slug, `/dashboard/goals/${r.id}`, p.accountSlug ? { accountSlug: p.accountSlug } : {}),
    });
  }
  return { goals, withheld: [...counted.values()] };
}
