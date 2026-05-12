/**
 * RetrievalService — hybrid (vector + keyword) search over knowledge_*
 * tables. Read path; writes live in IngestionService.
 *
 * Three retrieval modes, one entry point:
 *
 *   1. **vector** — pgvector HNSW cosine search. Best for paraphrases,
 *      conceptual matches, "find me docs about X".
 *   2. **keyword** — Postgres ts_rank on the generated tsvector column.
 *      Best for exact terms, identifiers, error codes.
 *   3. **hybrid** (default) — fuse the two via Reciprocal Rank Fusion.
 *      Cheaper than the rerank pass we'll layer in L.5 and handles
 *      the long-tail of mixed conceptual/literal queries well.
 *
 * Why RRF rather than score-weighted sum?
 *
 *   - Vector distances and ts_rank values live on incomparable scales;
 *     normalising them is fiddly and brittle.
 *   - RRF (1/(k + rank)) is the de-facto baseline in Elastic, OpenSearch,
 *     and Vespa hybrid pipelines for this exact reason.
 *
 * Org isolation is enforced at every query — `orgId` is in every
 * WHERE clause, and the `knowledge_chunk.org_id` denormalisation
 * means the vector index seek hits no other org's rows.
 *
 * Tracing: each `search()` call opens a `retrieval.search` trace with
 * the mode + result count, nested under any active LangChain span when
 * called from the agent's `searchDocs` tool.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { langfuse, traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { embed } from '@/libs/retrieval/embedder';
import {
  knowledgeChunkSchema,
  knowledgeDocumentSchema,
  knowledgeSourceSchema,
} from '@/models/Schema';

export type SearchMode = 'vector' | 'keyword' | 'hybrid';

export type SearchOptions = {
  orgId: string;
  /** Optional user identifier for trace tagging. Use 'system' / 'agent' / 'eval' for non-interactive paths. */
  userId?: string;
  mode?: SearchMode;
  /** Top-K returned to the caller after fusion. */
  k?: number;
  /** Candidates pulled per arm before fusion. Defaults to 2 * k, capped at 50. */
  candidatesPerArm?: number;
  /** Filter to a single source by slug. Useful for org-scoped knowledge bases. */
  sourceSlug?: string;
  /** Filter to a list of source slugs. */
  sourceSlugs?: string[];
};

export type SearchHit = {
  chunkId: number;
  documentId: number;
  sourceId: number;
  sourceSlug: string;
  chunkIdx: number;
  content: string;
  title: string | null;
  uri: string | null;
  /** Fusion score (RRF) or arm score (vector/keyword alone). */
  score: number;
  /** Per-arm raw scores for debugging / future rerankers. */
  scores: { vector?: number; keyword?: number };
};

const DEFAULT_K = 8;
const DEFAULT_RRF_K = 60; // RRF constant; 60 is the textbook value.

/**
 * Run a search. Returns hits sorted by score descending. Empty array
 * when there are no documents for the org (or no matches).
 * @param query
 * @param opts
 */
export async function search(query: string, opts: SearchOptions): Promise<SearchHit[]> {
  const mode = opts.mode ?? 'hybrid';
  const k = opts.k ?? DEFAULT_K;
  const perArm = Math.min(opts.candidatesPerArm ?? k * 2, 50);

  const trace = traceFor({
    feature: FEATURES.RETRIEVAL_SEARCH,
    slug: opts.sourceSlug ?? 'all',
    orgId: opts.orgId,
    userId: opts.userId ?? 'system',
    input: { query, mode, k },
    metadata: { perArm, sourceSlug: opts.sourceSlug, sourceSlugs: opts.sourceSlugs },
  });

  try {
    const sourceFilter = await resolveSourceFilter(opts);
    if (sourceFilter && sourceFilter.length === 0) {
      // Caller filtered to a source that doesn't exist for this org.
      trace.update({ output: { hits: 0, reason: 'no-matching-source' } });
      return [];
    }

    let vectorHits: RawHit[] = [];
    let keywordHits: RawHit[] = [];

    if (mode === 'vector' || mode === 'hybrid') {
      vectorHits = await vectorSearch(query, opts.orgId, sourceFilter, perArm);
    }
    if (mode === 'keyword' || mode === 'hybrid') {
      keywordHits = await keywordSearch(query, opts.orgId, sourceFilter, perArm);
    }

    const fused = fuse(mode, vectorHits, keywordHits, k);
    if (fused.length === 0) {
      trace.update({ output: { hits: 0 } });
      return [];
    }

    const detailed = await hydrate(fused);
    trace.update({ output: { hits: detailed.length, mode } });
    return detailed;
  } finally {
    void langfuse.flushAsync();
  }
}

/* ------------------------------------------------------------------ */
/* internals                                                           */
/* ------------------------------------------------------------------ */

type RawHit = { chunkId: number; score: number };

async function resolveSourceFilter(opts: SearchOptions): Promise<number[] | null> {
  const slugs = opts.sourceSlugs ?? (opts.sourceSlug ? [opts.sourceSlug] : null);
  if (!slugs) {
    return null;
  }
  const rows = await db
    .select({ id: knowledgeSourceSchema.id })
    .from(knowledgeSourceSchema)
    .where(and(
      eq(knowledgeSourceSchema.orgId, opts.orgId),
      inArray(knowledgeSourceSchema.slug, slugs),
    ));
  return rows.map(r => r.id);
}

async function vectorSearch(
  query: string,
  orgId: string,
  sourceIds: number[] | null,
  limit: number,
): Promise<RawHit[]> {
  const [queryVec] = await embed([query], { orgId, purpose: 'query' });
  if (!queryVec) {
    return [];
  }
  // pgvector cosine-distance operator: `<=>`. Smaller = closer.
  // We convert to a similarity score in [0,1] so RRF + caller-side
  // sorting both treat "higher = better".
  const literal = sql.raw(`'[${queryVec.join(',')}]'::vector`);
  type Row = { id: number; distance: number };
  const result = sourceIds
    ? await db.execute(sql`
        SELECT c.id, (c.embedding <=> ${literal}) AS distance
        FROM ${knowledgeChunkSchema} c
        JOIN ${knowledgeDocumentSchema} d ON d.id = c.document_id
        WHERE c.org_id = ${orgId}
          AND d.source_id IN (${sql.join(sourceIds.map(id => sql`${id}`), sql`, `)})
        ORDER BY c.embedding <=> ${literal}
        LIMIT ${limit}
      `)
    : await db.execute(sql`
        SELECT c.id, (c.embedding <=> ${literal}) AS distance
        FROM ${knowledgeChunkSchema} c
        WHERE c.org_id = ${orgId}
        ORDER BY c.embedding <=> ${literal}
        LIMIT ${limit}
      `);
  const rows = (result as unknown as { rows: Row[] }).rows;
  return rows.map(r => ({
    chunkId: r.id,
    score: 1 - Number(r.distance), // cosine distance → similarity
  }));
}

async function keywordSearch(
  query: string,
  orgId: string,
  sourceIds: number[] | null,
  limit: number,
): Promise<RawHit[]> {
  // websearch_to_tsquery handles user-shaped queries (quotes, OR, -term)
  // gracefully. Falls back to AND of stemmed tokens when no operators.
  const tsq = sql`websearch_to_tsquery('english', ${query})`;
  type Row = { id: number; rank: number };
  const result = sourceIds
    ? await db.execute(sql`
        SELECT c.id, ts_rank(c.tsv, ${tsq}) AS rank
        FROM ${knowledgeChunkSchema} c
        JOIN ${knowledgeDocumentSchema} d ON d.id = c.document_id
        WHERE c.org_id = ${orgId}
          AND d.source_id IN (${sql.join(sourceIds.map(id => sql`${id}`), sql`, `)})
          AND c.tsv @@ ${tsq}
        ORDER BY rank DESC
        LIMIT ${limit}
      `)
    : await db.execute(sql`
        SELECT c.id, ts_rank(c.tsv, ${tsq}) AS rank
        FROM ${knowledgeChunkSchema} c
        WHERE c.org_id = ${orgId}
          AND c.tsv @@ ${tsq}
        ORDER BY rank DESC
        LIMIT ${limit}
      `);
  const rows = (result as unknown as { rows: Row[] }).rows;
  return rows.map(r => ({ chunkId: r.id, score: Number(r.rank) }));
}

/**
 * Fuse two ranked lists via Reciprocal Rank Fusion. When mode !==
 * 'hybrid' we short-circuit and return the single arm's scores
 * unchanged so the caller can introspect the raw similarity.
 * @param mode
 * @param vec
 * @param kw
 * @param k
 */
function fuse(
  mode: SearchMode,
  vec: RawHit[],
  kw: RawHit[],
  k: number,
): Array<RawHit & { scores: { vector?: number; keyword?: number } }> {
  if (mode === 'vector') {
    return vec.slice(0, k).map(h => ({ ...h, scores: { vector: h.score } }));
  }
  if (mode === 'keyword') {
    return kw.slice(0, k).map(h => ({ ...h, scores: { keyword: h.score } }));
  }
  const merged = new Map<
    number,
    { rrf: number; scores: { vector?: number; keyword?: number } }
  >();
  vec.forEach((h, i) => {
    merged.set(h.chunkId, {
      rrf: 1 / (DEFAULT_RRF_K + i + 1),
      scores: { vector: h.score },
    });
  });
  kw.forEach((h, i) => {
    const prev = merged.get(h.chunkId);
    const inc = 1 / (DEFAULT_RRF_K + i + 1);
    if (prev) {
      prev.rrf += inc;
      prev.scores.keyword = h.score;
    } else {
      merged.set(h.chunkId, {
        rrf: inc,
        scores: { keyword: h.score },
      });
    }
  });
  return Array.from(merged.entries())
    .map(([chunkId, v]) => ({ chunkId, score: v.rrf, scores: v.scores }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/**
 * Hydrate fused chunkIds into a SearchHit shape — joins document +
 * source for title/uri/slug. Order is preserved via a lookup map
 * (the IN(...) query doesn't preserve input order).
 * @param fused
 */
async function hydrate(
  fused: Array<{ chunkId: number; score: number; scores: { vector?: number; keyword?: number } }>,
): Promise<SearchHit[]> {
  const ids = fused.map(f => f.chunkId);
  const rows = await db
    .select({
      chunkId: knowledgeChunkSchema.id,
      documentId: knowledgeChunkSchema.documentId,
      chunkIdx: knowledgeChunkSchema.chunkIdx,
      content: knowledgeChunkSchema.content,
      title: knowledgeDocumentSchema.title,
      uri: knowledgeDocumentSchema.uri,
      sourceId: knowledgeDocumentSchema.sourceId,
      sourceSlug: knowledgeSourceSchema.slug,
    })
    .from(knowledgeChunkSchema)
    .innerJoin(knowledgeDocumentSchema, eq(knowledgeChunkSchema.documentId, knowledgeDocumentSchema.id))
    .innerJoin(knowledgeSourceSchema, eq(knowledgeDocumentSchema.sourceId, knowledgeSourceSchema.id))
    .where(inArray(knowledgeChunkSchema.id, ids));
  const byId = new Map(rows.map(r => [r.chunkId, r]));
  return fused
    .map((f) => {
      const r = byId.get(f.chunkId);
      if (!r) {
        return null;
      }
      return {
        chunkId: r.chunkId,
        documentId: r.documentId,
        sourceId: r.sourceId,
        sourceSlug: r.sourceSlug,
        chunkIdx: r.chunkIdx,
        content: r.content,
        title: r.title,
        uri: r.uri,
        score: f.score,
        scores: f.scores,
      } satisfies SearchHit;
    })
    .filter((x): x is SearchHit => x !== null);
}

/**
 * Recent ingest activity — drives the source catalog card and the
 * `/dashboard/sources/[slug]` detail page.
 * @param orgId
 * @param sourceId
 * @param limit
 */
export async function recentDocuments(orgId: string, sourceId: number, limit = 20): Promise<Array<{
  id: number;
  externalId: string;
  title: string | null;
  uri: string | null;
  ingestedAt: Date;
  lastSeenAt: Date;
}>> {
  const rows = await db
    .select({
      id: knowledgeDocumentSchema.id,
      externalId: knowledgeDocumentSchema.externalId,
      title: knowledgeDocumentSchema.title,
      uri: knowledgeDocumentSchema.uri,
      ingestedAt: knowledgeDocumentSchema.ingestedAt,
      lastSeenAt: knowledgeDocumentSchema.lastSeenAt,
    })
    .from(knowledgeDocumentSchema)
    .where(and(
      eq(knowledgeDocumentSchema.orgId, orgId),
      eq(knowledgeDocumentSchema.sourceId, sourceId),
    ))
    .orderBy(desc(knowledgeDocumentSchema.ingestedAt))
    .limit(limit);
  return rows;
}
