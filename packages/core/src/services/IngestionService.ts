/**
 * IngestionService — write path for the knowledge_source / knowledge_document
 * / knowledge_chunk tables. The retrieval path lives in RetrievalService.
 *
 * Designed for two callers:
 *
 *   1. **Source plugins** — Drive / GitHub / web crawlers hand us
 *      `{ externalId, content, ... }` records. We dedupe by content
 *      hash, chunk + embed when new, and update `last_seen_at` so the
 *      tombstoning sweep can prune deletions.
 *
 *   2. **Bootstrap ingests** — the vocion-docs source pre-loads
 *      `requirements/` + `docs/` markdown on first start. Same path,
 *      synthetic source id, content hash dedup keeps re-runs cheap.
 *
 * The ingestion is idempotent at the document level (content-hash
 * compare → skip embedding when unchanged) and at the chunk level
 * (delete-and-replace inside a transaction when content changes).
 *
 * Tracing: each `ingestDocument()` call opens a `retrieval.ingest`
 * trace tagged with `slug:<source-slug>`. Embedding batches are nested
 * via `embed()` so a doc with 12 chunks shows up as 1 trace with 1
 * embed-span (most docs fit in 1 batch).
 */

import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { chunkText, contentHash } from '@/libs/retrieval/chunker';
import { embed } from '@/libs/retrieval/embedder';
import {
  knowledgeChunkSchema,
  knowledgeDocumentSchema,
  knowledgeSourceSchema,
} from '@/models/Schema';

export type IngestDoc = {
  /** Stable upstream identifier — Drive fileId, repo+path, doc slug. */
  externalId: string;
  /** Plain-text content. Pre-cleaned by the caller (no HTML, no PDF binaries). */
  content: string;
  title?: string;
  uri?: string;
  /** ETag/last-modified from the upstream — stored for re-sync optimisation. */
  etag?: string | null;
  lastModifiedAt?: Date | null;
  /** Source-specific metadata to round-trip through to retrieval (e.g. author, repo). */
  metadata?: Record<string, unknown>;
  /**
   * Pre-computed embedding (1536-d, matching the active embedder).
   *
   * When provided, `ingestDocument` skips chunking + the OpenAI embed
   * call and stores the whole `content` as a single chunk with this
   * vector. Use for sources that ship their own embeddings (cached
   * fixture JSONLs, upstream systems that already vectorize).
   *
   * When absent, the normal chunk-then-embed path runs.
   */
  embedding?: number[];
};

export type IngestResult
  = | { status: 'unchanged'; documentId: number }
    | { status: 'created'; documentId: number; chunks: number }
    | { status: 'updated'; documentId: number; chunks: number };

export type SourceRef = {
  orgId: string;
  /** Knowledge source primary key — caller has already resolved it via `ensureSource`. */
  sourceId: number;
  /** Slug for tracing. */
  sourceSlug: string;
  /** Scope stamped onto every ingested doc + chunk. NULL = org-wide/shared. */
  clientId?: string | null;
  teamId?: string | null;
};

/**
 * Upsert a knowledge_source row by (orgId, slug). Returns the source
 * row's primary key + slug so callers can pass a `SourceRef` to
 * `ingestDocument`.
 * @param input
 * @param input.orgId
 * @param input.slug
 * @param input.kind
 * @param input.configJson
 * @param input.clientId
 * @param input.teamId
 */
export async function ensureSource(input: {
  orgId: string;
  slug: string;
  kind?: 'web' | 'plugin' | 'upload';
  configJson?: Record<string, unknown>;
  /** Scope to stamp on docs ingested under this ref. NULL = org-wide/shared. */
  clientId?: string | null;
  teamId?: string | null;
}): Promise<SourceRef> {
  const scope = { clientId: input.clientId ?? null, teamId: input.teamId ?? null };
  const existing = await db
    .select({ id: knowledgeSourceSchema.id })
    .from(knowledgeSourceSchema)
    .where(and(
      eq(knowledgeSourceSchema.orgId, input.orgId),
      eq(knowledgeSourceSchema.slug, input.slug),
    ))
    .limit(1);
  if (existing[0]) {
    return { orgId: input.orgId, sourceId: existing[0].id, sourceSlug: input.slug, ...scope };
  }
  const inserted = await db
    .insert(knowledgeSourceSchema)
    .values({
      orgId: input.orgId,
      slug: input.slug,
      kind: input.kind ?? 'plugin',
      configJson: input.configJson ?? {},
    })
    .returning({ id: knowledgeSourceSchema.id });
  return { orgId: input.orgId, sourceId: inserted[0]!.id, sourceSlug: input.slug, ...scope };
}

/**
 * Mark a source as "I just synced this." Drives the
 * `Last sync 4h ago` line on the source catalog card.
 * @param sourceId
 */
export async function markSourceSynced(sourceId: number): Promise<void> {
  await db
    .update(knowledgeSourceSchema)
    .set({ lastSyncedAt: new Date() })
    .where(eq(knowledgeSourceSchema.id, sourceId));
}

/**
 * Idempotent ingest of one document.
 *
 * Decision tree:
 *
 *   - No prior row → INSERT document + chunks (`status: 'created'`).
 *   - Prior row, same `content_hash` → bump `last_seen_at` only (`status: 'unchanged'`).
 *   - Prior row, different `content_hash` → delete chunks, re-embed,
 *     re-insert chunks, UPDATE the document row (`status: 'updated'`).
 *
 * Chunks + their embeddings are rewritten inside a single transaction
 * so retrieval never sees a half-empty document.
 * @param src
 * @param doc
 */
export async function ingestDocument(
  src: SourceRef,
  doc: IngestDoc,
): Promise<IngestResult> {
  const hash = await contentHash(doc.content);
  const scope = { clientId: src.clientId ?? null, teamId: src.teamId ?? null };
  const trace = traceFor({
    feature: FEATURES.RETRIEVAL_INGEST,
    slug: src.sourceSlug,
    orgId: src.orgId,
    userId: 'system',
    input: { externalId: doc.externalId, bytes: doc.content.length },
    metadata: { contentHash: hash },
  });

  try {
    const existing = await db
      .select({
        id: knowledgeDocumentSchema.id,
        contentHash: knowledgeDocumentSchema.contentHash,
      })
      .from(knowledgeDocumentSchema)
      .where(and(
        eq(knowledgeDocumentSchema.orgId, src.orgId),
        eq(knowledgeDocumentSchema.sourceId, src.sourceId),
        eq(knowledgeDocumentSchema.externalId, doc.externalId),
      ))
      .limit(1);

    // Unchanged: bump last_seen_at, no re-embed.
    if (existing[0] && existing[0].contentHash === hash) {
      await db
        .update(knowledgeDocumentSchema)
        .set({ lastSeenAt: new Date() })
        .where(eq(knowledgeDocumentSchema.id, existing[0].id));
      trace.update({ output: { status: 'unchanged', documentId: existing[0].id } });
      return { status: 'unchanged', documentId: existing[0].id };
    }

    // Pre-computed-embedding fast path: when the caller ships a vector,
    // skip chunkText + embed entirely and store the whole content as a
    // single chunk. Used by sources whose data is shipped pre-embedded
    // (e.g. the support-reply demo's tickets.jsonl fixture).
    const chunks = doc.embedding
      ? [{ index: 0, content: doc.content, tokens: 0 }]
      : chunkText(doc.content);
    if (chunks.length === 0) {
      // Empty doc — store the row but no chunks. Caller can decide whether to filter.
      const inserted = existing[0]
        ? existing[0].id
        : (await db
            .insert(knowledgeDocumentSchema)
            .values({
              orgId: src.orgId,
              sourceId: src.sourceId,
              externalId: doc.externalId,
              uri: doc.uri,
              title: doc.title,
              metadata: doc.metadata ?? {},
              contentHash: hash,
              etag: doc.etag ?? null,
              lastModifiedAt: doc.lastModifiedAt ?? null,
              ...scope,
            })
            .returning({ id: knowledgeDocumentSchema.id }))[0]!.id;
      trace.update({ output: { status: existing[0] ? 'updated' : 'created', chunks: 0 } });
      return existing[0]
        ? { status: 'updated', documentId: inserted, chunks: 0 }
        : { status: 'created', documentId: inserted, chunks: 0 };
    }

    const vectors = doc.embedding
      ? [doc.embedding]
      : await embed(
          chunks.map(c => c.content),
          { orgId: src.orgId, purpose: 'ingest', sourceSlug: src.sourceSlug },
        );
    if (vectors.length !== chunks.length) {
      throw new Error(
        `embed() returned ${vectors.length} vectors for ${chunks.length} chunks — refusing partial insert`,
      );
    }

    // Transaction: replace document row + chunk rows atomically.
    const result = await db.transaction(async (tx) => {
      let documentId: number;
      let status: 'created' | 'updated';
      if (existing[0]) {
        documentId = existing[0].id;
        status = 'updated';
        await tx
          .update(knowledgeDocumentSchema)
          .set({
            uri: doc.uri,
            title: doc.title,
            metadata: doc.metadata ?? {},
            contentHash: hash,
            etag: doc.etag ?? null,
            lastModifiedAt: doc.lastModifiedAt ?? null,
            ingestedAt: new Date(),
            lastSeenAt: new Date(),
            ...scope,
          })
          .where(eq(knowledgeDocumentSchema.id, documentId));
        await tx
          .delete(knowledgeChunkSchema)
          .where(eq(knowledgeChunkSchema.documentId, documentId));
      } else {
        status = 'created';
        const inserted = await tx
          .insert(knowledgeDocumentSchema)
          .values({
            orgId: src.orgId,
            sourceId: src.sourceId,
            externalId: doc.externalId,
            uri: doc.uri,
            title: doc.title,
            metadata: doc.metadata ?? {},
            contentHash: hash,
            etag: doc.etag ?? null,
            lastModifiedAt: doc.lastModifiedAt ?? null,
            ...scope,
          })
          .returning({ id: knowledgeDocumentSchema.id });
        documentId = inserted[0]!.id;
      }

      // Drizzle's `vector(...)` column accepts number[] on insert and
      // serializes to pgvector's `'[0.1,0.2,...]'` string format.
      await tx.insert(knowledgeChunkSchema).values(
        chunks.map((c, i) => ({
          documentId,
          orgId: src.orgId,
          chunkIdx: c.index,
          content: c.content,
          contentTokens: c.tokens,
          embedding: vectors[i]!,
          metadata: {},
          ...scope,
        })),
      );

      return { status, documentId };
    });

    trace.update({ output: { ...result, chunks: chunks.length } });
    return { ...result, chunks: chunks.length };
  } catch (err) {
    trace.update({
      output: { error: err instanceof Error ? err.message : String(err) },
      // Note: langfuse@3 doesn't accept a trace-level `level`; the
      // failure shows up as a non-200 if a span inside also errored.
    });
    throw err;
  }
}

/**
 * Tombstone documents that haven't been seen since `cutoff`. Source
 * plugins call this at the end of a sync to prune deletes (a document
 * stays in the DB until the next full sync confirms it's gone).
 * @param src
 * @param cutoff
 */
export async function tombstoneMissing(
  src: SourceRef,
  cutoff: Date,
): Promise<{ deleted: number }> {
  const rows = await db
    .select({ id: knowledgeDocumentSchema.id })
    .from(knowledgeDocumentSchema)
    .where(and(
      eq(knowledgeDocumentSchema.orgId, src.orgId),
      eq(knowledgeDocumentSchema.sourceId, src.sourceId),
      lt(knowledgeDocumentSchema.lastSeenAt, cutoff),
    ));
  if (rows.length === 0) {
    return { deleted: 0 };
  }
  await db
    .delete(knowledgeDocumentSchema)
    .where(inArray(knowledgeDocumentSchema.id, rows.map(r => r.id)));
  return { deleted: rows.length };
}

/**
 * Count chunks for a given source — drives the catalog-card footer.
 * Cheap because of the `knowledge_chunk_org_doc_idx_idx` btree.
 * @param orgId
 * @param sourceId
 */
export async function countChunks(orgId: string, sourceId: number): Promise<number> {
  const row = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(knowledgeChunkSchema)
    .innerJoin(knowledgeDocumentSchema, eq(knowledgeChunkSchema.documentId, knowledgeDocumentSchema.id))
    .where(and(
      eq(knowledgeChunkSchema.orgId, orgId),
      eq(knowledgeDocumentSchema.sourceId, sourceId),
    ));
  return row[0]?.count ?? 0;
}
