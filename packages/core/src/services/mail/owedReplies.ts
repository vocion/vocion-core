/**
 * Mail replies owed, read from the state filed at sync — one query, no
 * phrase hunt (`libs/retrieval/facets.ts` says why).
 *
 * Index first, live only for the gap. Every answer says how fresh the index
 * is (each source's sync watermark). A caller asking about "right now" passes
 * `live`, and only then is Gmail read — for mail NEWER than the watermark, by
 * headers alone (who wrote last), labelled by the facts with no model. What
 * came from where is on every row (`from: 'index' | 'live'`), so the answer
 * can say so.
 */
import type { FacetFilter, ReplyState, ThreadCategory } from '@/libs/retrieval/facets';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { facetWhere, MAIL_THREAD_STATE_KIND } from '@/libs/retrieval/facets';
import { fallbackLabel } from '@/libs/sources/mailThreadState';
import { knowledgeDocumentSchema, knowledgeSourceSchema, sourceSyncCheckpointSchema } from '@/models/Schema';

/** How far back an owed reply is looked for when the caller names no date. */
export const DEFAULT_OWED_WINDOW_DAYS = 30;
/** Rows named; the rest are a count. */
export const OWED_TOP = 25;

export type OwedReply = {
  documentId: number | null;
  sourceSlug: string;
  threadId: string;
  subject: string;
  counterpart: string;
  ask: string;
  category: ThreadCategory | 'unknown';
  state: ReplyState;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  uri: string | null;
  mailbox: string;
  from: 'index' | 'live';
};

export type OwedRepliesRead = {
  items: OwedReply[];
  /** Matching threads in the index, before the cap. */
  total: number;
  /** Each mail source's last completed sync, the index's freshness. */
  watermarks: Array<{ sourceSlug: string; syncedAt: Date | null }>;
  /** Threads read live past the watermark, when asked for. */
  live?: { checked: number; error?: string };
};

export type OwedRepliesQuery = {
  orgId: string;
  /** The person's readable sources; omitted means no narrowing. */
  allowedSourceSlugs?: string[];
  states?: ReplyState[];
  category?: ThreadCategory[];
  /** A name, address or domain on the other side. */
  person?: string;
  /** Only the mailbox of this address. */
  mailbox?: string;
  /** The other side wrote at or after this. */
  since?: Date;
  limit?: number;
  now?: Date;
};

type StateRow = { id: number; title: string | null; uri: string | null; metadata: Record<string, unknown>; slug: string; lastModifiedAt: Date | null };

function toOwed(r: StateRow): OwedReply {
  const f = (r.metadata.facets ?? {}) as Record<string, unknown>;
  const at = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);
  const subject = typeof r.metadata.subject === 'string' ? r.metadata.subject : (r.title ?? '');
  return {
    documentId: r.id,
    sourceSlug: r.slug,
    threadId: String(r.metadata.threadId ?? ''),
    subject: subject || '(no subject)',
    counterpart: String(f.counterpart ?? ''),
    ask: String(f.ask ?? ''),
    category: (typeof f.category === 'string' ? f.category : 'unknown') as OwedReply['category'],
    state: f.reply_state as ReplyState,
    lastInboundAt: at(f.last_inbound_at),
    lastOutboundAt: at(f.last_outbound_at),
    uri: r.uri,
    mailbox: String(f.mailbox ?? ''),
    from: 'index',
  };
}

/**
 * The mail sources a reader may see, by slug and id.
 * @param orgId - Tenant.
 * @param allowed - The person's readable slugs, if narrowed.
 */
async function mailSources(orgId: string, allowed?: string[]): Promise<Array<{ id: number; slug: string }>> {
  const rows = await db
    .select({ id: knowledgeSourceSchema.id, slug: knowledgeSourceSchema.slug })
    .from(knowledgeSourceSchema)
    .where(and(
      eq(knowledgeSourceSchema.orgId, orgId),
      sql`(${knowledgeSourceSchema.slug} = 'gmail' OR ${knowledgeSourceSchema.configJson} ->> '_connector' = 'gmail')`,
    ));
  return allowed ? rows.filter(r => allowed.includes(r.slug)) : rows;
}

/**
 * Owed replies (or any reply state) from the index. Never reads a vendor.
 * @param q - What to read.
 */
export async function readOwedReplies(q: OwedRepliesQuery): Promise<OwedRepliesRead> {
  const now = q.now ?? new Date();
  const sources = await mailSources(q.orgId, q.allowedSourceSlugs);
  if (sources.length === 0) {
    return { items: [], total: 0, watermarks: [] };
  }
  const since = q.since ?? new Date(now.getTime() - DEFAULT_OWED_WINDOW_DAYS * 86_400_000);
  const filter: FacetFilter = {
    reply_state: q.states ?? ['needs_my_reply'],
    last_inbound_at: { since: since.toISOString() },
    ...(q.category?.length ? { category: q.category } : {}),
    ...(q.person ? { counterpart: q.person } : {}),
    ...(q.mailbox ? { mailbox: q.mailbox } : {}),
  };
  const where = and(
    eq(knowledgeDocumentSchema.orgId, q.orgId),
    inArray(knowledgeDocumentSchema.sourceId, sources.map(s => s.id)),
    sql`${knowledgeDocumentSchema.metadata} ->> 'kind' = ${MAIL_THREAD_STATE_KIND}`,
    facetWhere(filter, sql`${knowledgeDocumentSchema.metadata}`)!,
  );
  const [rows, [count], checkpoints] = await Promise.all([
    db
      .select({
        id: knowledgeDocumentSchema.id,
        title: knowledgeDocumentSchema.title,
        uri: knowledgeDocumentSchema.uri,
        metadata: knowledgeDocumentSchema.metadata,
        slug: knowledgeSourceSchema.slug,
        lastModifiedAt: knowledgeDocumentSchema.lastModifiedAt,
      })
      .from(knowledgeDocumentSchema)
      .innerJoin(knowledgeSourceSchema, eq(knowledgeSourceSchema.id, knowledgeDocumentSchema.sourceId))
      .where(where)
      // Longest-waiting first: the same order the review queue reads.
      .orderBy(asc(sql`${knowledgeDocumentSchema.metadata} -> 'facets' ->> 'last_inbound_at'`))
      .limit(q.limit ?? OWED_TOP),
    db.select({ n: sql<number>`count(*)::int` }).from(knowledgeDocumentSchema).where(where),
    db
      .select({ sourceId: sourceSyncCheckpointSchema.sourceId, since: sourceSyncCheckpointSchema.since, completedAt: sourceSyncCheckpointSchema.completedAt })
      .from(sourceSyncCheckpointSchema)
      .where(inArray(sourceSyncCheckpointSchema.sourceId, sources.map(s => s.id))),
  ]);
  const syncedAt = new Map(checkpoints.map(c => [c.sourceId, c.since ?? c.completedAt ?? null]));
  return {
    items: rows.map(r => toOwed(r as StateRow)),
    total: count?.n ?? rows.length,
    watermarks: sources.map(s => ({ sourceSlug: s.slug, syncedAt: syncedAt.get(s.id) ?? null })),
  };
}

/**
 * Add what arrived after each source's watermark, read live by headers. Rows
 * already in the index for the same thread are replaced by the live read, which
 * is newer. Never throws: a failed live read is reported on the result.
 * @param read - The index read.
 * @param q - The same query.
 */
export async function withLiveGap(read: OwedRepliesRead, q: OwedRepliesQuery): Promise<OwedRepliesRead> {
  const sources = await mailSources(q.orgId, q.allowedSourceSlugs);
  const states = new Set(q.states ?? ['needs_my_reply']);
  let checked = 0;
  try {
    const { firstCredentialed } = await import('@/services/agents/tools/zoomTranscript');
    const { liveThreadFactsSince, gmailThreadUrl } = await import('@/libs/sources/gmail');
    const items = [...read.items];
    for (const source of sources) {
      const mark = read.watermarks.find(w => w.sourceSlug === source.slug)?.syncedAt ?? new Date(Date.now() - 86_400_000);
      const cred = await firstCredentialed(q.orgId, [source]);
      if (!cred) {
        continue;
      }
      const live = await liveThreadFactsSince({ orgId: q.orgId, credentials: cred.credentials, after: mark });
      if (!live) {
        continue;
      }
      checked += live.facts.length;
      for (const f of live.facts) {
        const label = fallbackLabel(f);
        const at = items.findIndex(i => i.threadId === f.threadId);
        if (at !== -1) {
          items.splice(at, 1);
        }
        if (!states.has(label.state)) {
          continue;
        }
        if (q.person && !f.counterpart.toLowerCase().includes(q.person.toLowerCase())) {
          continue;
        }
        items.push({
          documentId: null,
          sourceSlug: source.slug,
          threadId: f.threadId,
          subject: f.subject,
          counterpart: f.counterpart,
          ask: '',
          category: 'unknown',
          state: label.state,
          lastInboundAt: f.lastInboundAt,
          lastOutboundAt: f.lastOutboundAt,
          uri: gmailThreadUrl(live.mailbox, f.threadId),
          mailbox: live.mailbox,
          from: 'live',
        });
      }
    }
    return { ...read, items, live: { checked } };
  } catch (error) {
    return { ...read, live: { checked, error: error instanceof Error ? error.message : String(error) } };
  }
}
