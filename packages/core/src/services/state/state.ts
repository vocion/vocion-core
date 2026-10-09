/**
 * STATE QUERIES — one read for "what is in this state" across every kind of
 * thing a workspace syncs or keeps: email threads, meetings, deals, issues,
 * pull requests, chat messages, invoices, and Vocion's own decisions and
 * connections. One shape in, one shape out (`StateRow`), whatever the source.
 *
 * A query names the kinds it reads (facet sets, `libs/retrieval/facets.ts`),
 * a facet filter, a sort and a limit. Documents are read from the index with
 * the filter in SQL; Vocion's own records (`vocion.*`) are read from their
 * tables by a small reader each. Nothing here reads a vendor: the index
 * answers, and the output says how fresh each source is.
 *
 * Saved views are stored queries (`services/state/state.ts`); the agent tool is `query_state`.
 */

//
// One module on purpose: every route that reaches the agent tools reaches this, and the build
// budget (`scripts/check-route-graph.ts`) counts modules per route. Sections: state queries, saved
// views, learning views, the live gap.

import type { SQL } from 'drizzle-orm';
import type { FacetContext, FacetFilter, FacetSet, FacetSpec } from '@/libs/retrieval/facets';
import { and, count, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { facetSet, facetsMatch, facetValueOf, facetWhere, validateFacetFilter } from '@/libs/retrieval/facets';
import { fallbackLabel, threadStateDoc, threadStateExternalId } from '@/libs/sources/mailThreadState';
import coreViewsData from '@/libs/state/coreViews.json';
import { knowledgeDocumentSchema, knowledgeSourceSchema, sourceSyncCheckpointSchema, stateQueryLogSchema, stateViewSchema } from '@/models/Schema';

/** A stored or ad-hoc state query. */
export type StateQuery = {
  /** Kinds to read: facet set ids (`mail.thread`, `crm.deal`) or record sets (`vocion.decision`). */
  sets: string[];
  filter?: FacetFilter;
  sort?: { facet: string; dir: 'asc' | 'desc' };
  limit?: number;
};

/** One thing in a state, whatever its kind. */
export type StateRow = {
  set: string;
  noun: string;
  /** The indexed document, when it is one. */
  documentId: number | null;
  /** Its stable key at the source (the document's external id), to match a live read against. */
  key: string | null;
  /** Read live past the sync watermark rather than from the index. */
  live?: boolean;
  title: string;
  /** Where a person opens it. */
  link: string | null;
  /** Its date: the sort facet's when it is a date, else the document's own. */
  at: Date | null;
  /** Its facets, by name, as stored. */
  facets: Record<string, unknown>;
  sourceSlug: string | null;
  /** Where it lives, when a read spans workspaces: "Deal Desk · Kestrel Capital" (Personal's reads across Orgs). */
  where?: string;
};

export type StateRead = {
  rows: StateRow[];
  /** Matching items before the limit. */
  total: number;
  /** Each source read, with when it last synced — the index's freshness. */
  sources: Array<{ slug: string; syncedAt: Date | null }>;
  /** Kinds asked for that nothing connected here carries. */
  missing: string[];
};

export type StateContext = FacetContext & {
  /** The workspace(s) to read. */
  orgIds: string[];
  /** The person's readable sources; omitted means no narrowing. */
  allowedSourceSlugs?: string[];
  /** The person, for record sets that are per person. */
  userId?: string;
};

/** Vocion's own records, read in the same shape. */
type RecordSet = {
  id: string;
  noun: string;
  description: string;
  read: (ctx: StateContext, limit: number) => Promise<{ rows: StateRow[]; total: number }>;
};

export const RECORD_SETS: readonly RecordSet[] = [
  {
    id: 'vocion.decision',
    noun: 'decision',
    description: 'decisions in the review queue that are the person\'s to make (asks, approvals, proposed actions)',
    async read(ctx, limit) {
      if (!ctx.userId) {
        return { rows: [], total: 0 };
      }
      const { listInboxForUser } = await import('@/services/inbox/acrossWorkspaces');
      const { needsYouItems } = await import('@/services/InboxService');
      const wanted = new Set(ctx.orgIds);
      const inbox = await listInboxForUser(ctx.userId, { read: id => (wanted.has(id) ? needsYouItems(id) : Promise.resolve([])) });
      const mine = inbox.items.filter(i => wanted.has(i.workspace.id) && i.yours);
      return {
        total: mine.length,
        rows: mine.slice(0, limit).map(i => ({
          set: 'vocion.decision',
          noun: 'decision',
          documentId: null,
          key: `decision:${i.key}`,
          title: i.title,
          link: i.link,
          at: i.at,
          facets: { kind: i.kind, risk: i.risk ?? null, workspace: i.workspace.name },
          sourceSlug: null,
        })),
      };
    },
  },
  {
    id: 'vocion.connection',
    noun: 'connection',
    description: 'connected systems whose last sync failed, with the reason',
    async read(ctx, limit) {
      const rows = await db
        .select({ slug: knowledgeSourceSchema.slug, orgId: knowledgeSourceSchema.orgId, status: sourceSyncCheckpointSchema.status, error: sourceSyncCheckpointSchema.error, at: sourceSyncCheckpointSchema.completedAt, startedAt: sourceSyncCheckpointSchema.startedAt })
        .from(sourceSyncCheckpointSchema)
        .innerJoin(knowledgeSourceSchema, eq(knowledgeSourceSchema.id, sourceSyncCheckpointSchema.sourceId))
        .where(and(inArray(knowledgeSourceSchema.orgId, ctx.orgIds), eq(sourceSyncCheckpointSchema.status, 'failed')));
      const visible = ctx.allowedSourceSlugs ? rows.filter(r => ctx.allowedSourceSlugs!.includes(r.slug)) : rows;
      return {
        total: visible.length,
        rows: visible.slice(0, limit).map(r => ({
          set: 'vocion.connection',
          noun: 'connection',
          documentId: null,
          key: `connection:${r.orgId}:${r.slug}`,
          title: r.slug,
          link: `/dashboard/connectors/${encodeURIComponent(r.slug)}`,
          at: r.at ?? r.startedAt,
          facets: { status: r.status, error: (r.error ?? '').slice(0, 240) },
          sourceSlug: r.slug,
        })),
      };
    },
  },
];

/**
 * A record set by id.
 * @param id - `vocion.decision`, …
 */
export function recordSet(id: string): RecordSet | undefined {
  return RECORD_SETS.find(s => s.id === id);
}

export type QueryProblem = { message: string };

/**
 * What is wrong with a query, in words the model can act on. Empty when it
 * can run.
 * @param q - The query.
 */
export function checkQuery(q: StateQuery): QueryProblem[] {
  const problems: QueryProblem[] = [];
  if (!q.sets?.length) {
    problems.push({ message: 'name at least one kind in `sets`' });
    return problems;
  }
  const unknown = q.sets.filter(s => !facetSet(s) && !recordSet(s));
  if (unknown.length > 0) {
    problems.push({ message: `unknown kind${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')}` });
  }
  const docSets = q.sets.map(facetSet).filter((s): s is FacetSet => !!s);
  if (q.filter && Object.keys(q.filter).length > 0 && docSets.length > 0) {
    problems.push(...validateFacetFilter(q.filter, docSets).map(e => ({ message: e.message })));
  }
  if (q.sort && docSets.length > 0 && !docSets.some(s => s.facets.some(f => f.name === q.sort!.facet))) {
    problems.push({ message: `cannot sort by "${q.sort.facet}"; sort by one of the kinds' facets` });
  }
  return problems;
}

/**
 * The ORDER BY for a sort facet across sets (each set may keep it at a
 * different path), with a stable tiebreak.
 * @param sets - The document sets read.
 * @param sort - The sort.
 */
function orderBy(sets: FacetSet[], sort: StateQuery['sort']): SQL {
  const updated = sql`COALESCE(${knowledgeDocumentSchema.lastModifiedAt}, ${knowledgeDocumentSchema.ingestedAt})`;
  if (!sort || sort.facet === 'updated_at') {
    return sort?.dir === 'asc' ? sql`${updated} ASC` : sql`${updated} DESC`;
  }
  const specs = sets.map(s => s.facets.find(f => f.name === sort.facet)).filter((f): f is FacetSpec => !!f);
  const spec = specs[0];
  const path = (spec?.path ?? `facets.${sort.facet}`).split('.');
  const raw = sql`(${knowledgeDocumentSchema.metadata} #>> ${`{${path.join(',')}}`})`;
  const key = spec?.kind === 'number' ? sql`(${raw})::numeric` : raw;
  return sort.dir === 'asc' ? sql`${key} ASC NULLS LAST` : sql`${key} DESC NULLS LAST`;
}

/**
 * Run a state query. Never reads a vendor.
 * @param q - The query (checked with `checkQuery` first).
 * @param ctx - Where, for whom, and when.
 */
export async function runStateQuery(q: StateQuery, ctx: StateContext): Promise<StateRead> {
  const limit = Math.min(Math.max(q.limit ?? 25, 1), 100);
  const docSets = q.sets.map(facetSet).filter((s): s is FacetSet => !!s);
  const recSets = q.sets.map(recordSet).filter((s): s is RecordSet => !!s);
  const rows: StateRow[] = [];
  let total = 0;
  const sources = new Map<string, Date | null>();
  const missing: string[] = [];

  if (docSets.length > 0) {
    const srcRows = await db
      .select({ id: knowledgeSourceSchema.id, slug: knowledgeSourceSchema.slug, config: knowledgeSourceSchema.configJson })
      .from(knowledgeSourceSchema)
      .where(inArray(knowledgeSourceSchema.orgId, ctx.orgIds));
    const connectorOf = (r: { slug: string; config: unknown }) => ((r.config as { _connector?: string } | null)?._connector ?? r.slug);
    const wantedConnectors = new Set(docSets.map(s => s.connector));
    const readable = srcRows.filter(r => wantedConnectors.has(connectorOf(r)) && (!ctx.allowedSourceSlugs || ctx.allowedSourceSlugs.includes(r.slug)));
    for (const s of docSets) {
      if (!readable.some(r => connectorOf(r) === s.connector)) {
        missing.push(s.id);
      }
    }
    if (readable.length > 0) {
      const facetCond = facetWhere(q.filter, {
        metadata: sql`${knowledgeDocumentSchema.metadata}`,
        updatedAt: sql`COALESCE(${knowledgeDocumentSchema.lastModifiedAt}, ${knowledgeDocumentSchema.ingestedAt})`,
        sets: docSets,
        me: ctx.me,
        now: ctx.now,
      });
      const where = and(
        inArray(knowledgeDocumentSchema.orgId, ctx.orgIds),
        inArray(knowledgeDocumentSchema.sourceId, readable.map(r => r.id)),
        // Client-specific documents never surface in an unscoped read (the
        // same rule `RetrievalService` holds).
        isNull(knowledgeDocumentSchema.clientId),
        ...(facetCond ? [facetCond] : []),
      );
      const [found, [count], checkpoints] = await Promise.all([
        db
          .select({
            id: knowledgeDocumentSchema.id,
            externalId: knowledgeDocumentSchema.externalId,
            title: knowledgeDocumentSchema.title,
            uri: knowledgeDocumentSchema.uri,
            metadata: knowledgeDocumentSchema.metadata,
            sourceId: knowledgeDocumentSchema.sourceId,
            lastModifiedAt: knowledgeDocumentSchema.lastModifiedAt,
            ingestedAt: knowledgeDocumentSchema.ingestedAt,
          })
          .from(knowledgeDocumentSchema)
          .where(where)
          .orderBy(orderBy(docSets, q.sort), knowledgeDocumentSchema.id)
          .limit(limit),
        db.select({ n: sql<number>`count(*)::int` }).from(knowledgeDocumentSchema).where(where),
        db
          .select({ sourceId: sourceSyncCheckpointSchema.sourceId, since: sourceSyncCheckpointSchema.since, completedAt: sourceSyncCheckpointSchema.completedAt })
          .from(sourceSyncCheckpointSchema)
          .where(inArray(sourceSyncCheckpointSchema.sourceId, readable.map(r => r.id))),
      ]);
      const slugOf = new Map(readable.map(r => [r.id, r.slug]));
      const synced = new Map(checkpoints.map(c => [c.sourceId, c.since ?? c.completedAt ?? null]));
      for (const r of readable) {
        sources.set(r.slug, synced.get(r.id) ?? null);
      }
      total += count?.n ?? found.length;
      for (const d of found) {
        const meta = (d.metadata ?? {}) as Record<string, unknown>;
        const set = docSets.find(s => String(meta[s.match.key] ?? '') === s.match.value) ?? docSets[0]!;
        const facets: Record<string, unknown> = {};
        for (const f of set.facets) {
          facets[f.name] = f.name === 'updated_at' ? (d.lastModifiedAt ?? d.ingestedAt)?.toISOString() : facetValueOf(meta, f);
        }
        const sortSpec = q.sort ? set.facets.find(f => f.name === q.sort!.facet) : undefined;
        const sortAt = sortSpec?.kind === 'date' && typeof facets[sortSpec.name] === 'string' ? new Date(facets[sortSpec.name] as string) : null;
        rows.push({
          set: set.id,
          noun: set.noun,
          documentId: d.id,
          key: d.externalId,
          title: d.title ?? `${set.noun} ${d.id}`,
          link: d.uri,
          at: sortAt ?? d.lastModifiedAt ?? d.ingestedAt,
          facets,
          sourceSlug: slugOf.get(d.sourceId) ?? null,
        });
      }
    }
  }

  for (const rs of recSets) {
    const read = await rs.read(ctx, limit);
    rows.push(...read.rows);
    total += read.total;
  }
  return { rows: rows.slice(0, limit), total, sources: [...sources.entries()].map(([slug, syncedAt]) => ({ slug, syncedAt })), missing };
}

/**
 * The shape of a query — its kinds, and its filter's facets and values, in a
 * stable order — for noticing the same question asked again (`services/state/state.ts`).
 * Words never enter it: two people's phrasings of one question share a shape.
 * @param q - The query.
 */
export function queryShape(q: StateQuery): string {
  const filter = Object.keys(q.filter ?? {}).sort().map(k => [k, q.filter![k]]);
  return JSON.stringify({ sets: [...q.sets].sort(), filter, sort: q.sort ?? null });
}

/* ------------------------------------------------------------------ */
/* views                                                              */
/* ------------------------------------------------------------------ */

/**
 * SAVED VIEWS — named, described state queries, kept as rows.
 *
 * "Owed replies", "stale deals", "PRs awaiting my review": each is a stored
 * `StateQuery` (`services/state/state.ts`) with a name and a sentence saying what it
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
 * when a repeated question earns an offer (`services/state/state.ts`).
 */

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

/* ------------------------------------------------------------------ */
/* learnViews                                                         */
/* ------------------------------------------------------------------ */

/**
 * LEARNING A PERSON'S VIEWS — noticing the question they keep asking.
 *
 * Every `query_state` call a person makes is logged by its SHAPE (the kinds
 * and the filter, never the words: `queryShape`). When the same shape comes
 * up three times in two weeks, and none of the person's own views already is
 * that query, the tool's output says so to the agent — with a ready-made view
 * — and the agent decides whether to offer it. The offer is the agent's, in
 * the turn, as a Decision card (`view.save`): the system notices, the
 * assistant proposes, the person decides. Nothing is saved, scheduled or put
 * in a brief without that.
 */

/** How many times in the window makes a habit. */
export const REPEAT_THRESHOLD = 3;
/** The window, in days. */
export const REPEAT_WINDOW_DAYS = 14;
/** How long the log is kept. */
const KEEP_DAYS = 30;

export type ViewSuggestion = { shape: string; times: number; query: StateQuery; fromView?: string };

/**
 * Log one query and say whether it has become a habit worth a view. Never
 * throws: learning is a side line of the read, not part of it.
 * @param opts - Who asked what.
 * @param opts.orgId - The workspace.
 * @param opts.userId - The person.
 * @param opts.query - What ran.
 * @param opts.viewSlug - The view it ran, if it ran one.
 * @param opts.ownViews - The person's views, to see whether one already is this query.
 * @param opts.now - The clock.
 */
export async function noteQuery(opts: { orgId: string; userId: string; query: StateQuery; viewSlug?: string; ownViews: StateView[]; now?: Date }): Promise<ViewSuggestion | null> {
  const now = opts.now ?? new Date();
  const shape = queryShape(opts.query);
  try {
    await db.insert(stateQueryLogSchema).values({ orgId: opts.orgId, userId: opts.userId, shape, query: opts.query as unknown as Record<string, unknown>, viewSlug: opts.viewSlug ?? null, createdAt: now });
    await db.delete(stateQueryLogSchema).where(and(eq(stateQueryLogSchema.userId, opts.userId), lt(stateQueryLogSchema.createdAt, new Date(now.getTime() - KEEP_DAYS * 86_400_000))));
    // Already theirs: a person's own view of exactly this query needs no offer.
    if (opts.ownViews.some(v => v.scope === 'person' && queryShape(v.query) === shape)) {
      return null;
    }
    const [row] = await db
      .select({ n: count() })
      .from(stateQueryLogSchema)
      .where(and(
        eq(stateQueryLogSchema.userId, opts.userId),
        eq(stateQueryLogSchema.orgId, opts.orgId),
        eq(stateQueryLogSchema.shape, shape),
        gte(stateQueryLogSchema.createdAt, new Date(now.getTime() - REPEAT_WINDOW_DAYS * 86_400_000)),
      ));
    const times = Number(row?.n ?? 0);
    // Exactly at the threshold, so the offer is made once rather than on every
    // ask after it; a person who declined is not asked again until the next
    // window builds up.
    return times === REPEAT_THRESHOLD ? { shape, times, query: opts.query, ...(opts.viewSlug ? { fromView: opts.viewSlug } : {}) } : null;
  } catch {
    return null;
  }
}

/**
 * The line the agent reads when a question has become a habit.
 * @param s - The suggestion.
 */
export function suggestionNote(s: ViewSuggestion): string {
  return [
    `HABIT: the person has asked this same question ${s.times} times in the last ${REPEAT_WINDOW_DAYS} days.`,
    'After answering, you may offer — once, as a Decision card with recommend_action, action "view.save" — to save it as their own view, named in their words, optionally in their brief.',
    `Its query: ${JSON.stringify(s.query)}.`,
    'Do not save it yourself unless they ask; a schedule or automation from it is a separate ask that follows the trust ladder.',
  ].join(' ');
}

/* ------------------------------------------------------------------ */
/* liveGap                                                            */
/* ------------------------------------------------------------------ */

/**
 * INDEX FIRST, LIVE ONLY FOR THE GAP.
 *
 * A state read answers from the index (`services/state/state.ts`). When the person asks
 * about right now — "today", "the latest" — the agent passes `live`, and only
 * then is a vendor read: for mail newer than each source's sync watermark,
 * by headers alone, labelled by the facts with no model
 * (`mailThreadState.fallbackLabel`), and kept only when it matches the same
 * filter. Rows read this way are marked `live`; a live read of a thread the
 * index already holds replaces it, being newer.
 *
 * Mail is the one kind with a live gap reader today; another kind adds one
 * here when its questions need the last few minutes.
 */

export type LiveGap = { checked: number; error?: string };

/**
 * The index read plus what arrived since it was synced. Never throws.
 * @param read - The index read.
 * @param q - The query it answered.
 * @param ctx - Where and for whom.
 */
export async function withLiveGap(read: StateRead, q: StateQuery, ctx: StateContext): Promise<StateRead & { live?: LiveGap }> {
  const mail = facetSet('mail.thread');
  if (!mail || !q.sets.includes(mail.id)) {
    return read;
  }
  let checked = 0;
  try {
    const sources = (await db
      .select({ id: knowledgeSourceSchema.id, slug: knowledgeSourceSchema.slug })
      .from(knowledgeSourceSchema)
      .where(and(
        inArray(knowledgeSourceSchema.orgId, ctx.orgIds),
        sql`(${knowledgeSourceSchema.slug} = ${mail.connector} OR ${knowledgeSourceSchema.configJson} ->> '_connector' = ${mail.connector})`,
      )))
      .filter(s => !ctx.allowedSourceSlugs || ctx.allowedSourceSlugs.includes(s.slug));
    const { firstCredentialed } = await import('@/services/agents/tools/zoomTranscript');
    const { liveThreadFactsSince, gmailThreadUrl } = await import('@/libs/sources/gmail');
    const rows = [...read.rows];
    for (const source of sources) {
      const mark = read.sources.find(s => s.slug === source.slug)?.syncedAt ?? new Date(Date.now() - 86_400_000);
      const cred = await firstCredentialed(ctx.orgIds[0]!, [source]);
      if (!cred) {
        continue;
      }
      const live = await liveThreadFactsSince({ orgId: ctx.orgIds[0]!, credentials: cred.credentials, after: mark });
      if (!live) {
        continue;
      }
      checked += live.facts.length;
      for (const f of live.facts) {
        const key = threadStateExternalId(mail.connector, f.threadId);
        const doc = threadStateDoc(f, fallbackLabel(f), { connector: mail.connector, uri: gmailThreadUrl(live.mailbox, f.threadId) });
        const meta = doc.metadata as Record<string, unknown>;
        const held = rows.findIndex(r => r.key === key);
        if (held !== -1) {
          rows.splice(held, 1);
        }
        if (!facetsMatch(meta, q.filter, ctx, f.lastMessageAt)) {
          continue;
        }
        const facets: Record<string, unknown> = {};
        for (const spec of mail.facets) {
          facets[spec.name] = spec.name === 'updated_at' ? f.lastMessageAt.toISOString() : facetValueOf(meta, spec);
        }
        const row: StateRow = { set: mail.id, noun: mail.noun, documentId: null, key, live: true, title: doc.title ?? f.subject, link: doc.uri ?? null, at: f.lastInboundAt ?? f.lastMessageAt, facets, sourceSlug: source.slug };
        rows.push(row);
      }
    }
    return { ...read, rows, live: { checked } };
  } catch (error) {
    return { ...read, live: { checked, error: error instanceof Error ? error.message : String(error) } };
  }
}
