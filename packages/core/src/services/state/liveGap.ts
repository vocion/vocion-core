/**
 * INDEX FIRST, LIVE ONLY FOR THE GAP.
 *
 * A state read answers from the index (`queryState.ts`). When the person asks
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
import type { StateContext, StateQuery, StateRead, StateRow } from './queryState';
import { and, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { facetSet, facetsMatch, facetValueOf } from '@/libs/retrieval/facets';
import { fallbackLabel, threadStateDoc, threadStateExternalId } from '@/libs/sources/mailThreadState';
import { knowledgeSourceSchema } from '@/models/Schema';

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
