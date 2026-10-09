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
 * Saved views are stored queries (`views.ts`); the agent tool is `query_state`.
 */
import type { SQL } from 'drizzle-orm';
import type { FacetContext, FacetFilter, FacetSet, FacetSpec } from '@/libs/retrieval/facets';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { facetSet, facetValueOf, facetWhere, validateFacetFilter } from '@/libs/retrieval/facets';
import { knowledgeDocumentSchema, knowledgeSourceSchema, sourceSyncCheckpointSchema } from '@/models/Schema';

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
 * stable order — for noticing the same question asked again (`learnViews.ts`).
 * Words never enter it: two people's phrasings of one question share a shape.
 * @param q - The query.
 */
export function queryShape(q: StateQuery): string {
  const filter = Object.keys(q.filter ?? {}).sort().map(k => [k, q.filter![k]]);
  return JSON.stringify({ sets: [...q.sets].sort(), filter, sort: q.sort ?? null });
}
