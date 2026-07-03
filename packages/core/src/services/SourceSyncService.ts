/**
 * SourceSyncService — drives a connector's `sync()` iterator and
 * pipes each yielded document through IngestionService. Centralized
 * here so connectors stay narrow (just iterate; don't worry about
 * chunking, embedding, dedup, tombstoning).
 *
 * Two entrypoints:
 *
 *   - `addSource()` — creates a knowledge_source row from a picker
 *     submission. Persists the config_json blob (validated against
 *     the connector's `configSchema`).
 *
 *   - `runSync()` — fetches the row, instantiates a SourceContext,
 *     iterates `connector.sync()`, calls `ingestDocument` per yield,
 *     calls `tombstoneMissing` at the end. Returns aggregated counts.
 *
 * Sync runs are synchronous from the caller's POV (a request hangs
 * for the duration). For long crawls that's not great — the
 * follow-up wires this through Temporal so the UI can kick a sync
 * off, then poll status. Until then: cap pages low.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { getConnector } from '@/libs/sources/registry';
import { knowledgeDocumentSchema, knowledgeSourceSchema, sourceSyncCheckpointSchema } from '@/models/Schema';
import {
  ensureSource,
  ingestDocument,
  markSourceSynced,
  tombstoneMissing,
} from './IngestionService';
import { getCredentialsForSource } from './SourceCredentialService';

export type AddSourceInput = {
  orgId: string;
  /** Connector slug — `web`, `google-drive`, etc. */
  kind: string;
  /** Per-source slug the user picks. Falls back to a generated one. */
  slug?: string;
  configJson: Record<string, unknown>;
};

export async function addSource(input: AddSourceInput): Promise<{ id: number; slug: string }> {
  const connector = getConnector(input.kind);
  if (!connector) {
    throw new Error(`Unknown source connector: ${input.kind}`);
  }
  // Validate the config blob against the connector's schema. Throws
  // a ZodError with a usable message when the form data is bad.
  connector.configSchema.parse(input.configJson);

  const slug = input.slug ?? generateSlug(input.kind, input.configJson);
  const ref = await ensureSource({
    orgId: input.orgId,
    slug,
    kind: 'plugin',
    configJson: { ...input.configJson, _connector: input.kind },
  });
  return { id: ref.sourceId, slug };
}

export type SyncResult = {
  sourceId: number;
  created: number;
  updated: number;
  unchanged: number;
  tombstoned: number;
  errors: number;
};

/**
 * Begin a sync: read the prior watermark, mark the checkpoint `running`.
 * Returns the incremental `since` (only when `incremental`) + the resume `cursor`.
 * @param sourceId
 * @param orgId
 * @param incremental
 */
export async function beginSync(
  sourceId: number,
  orgId: string,
  incremental: boolean,
): Promise<{ since: Date | null; cursor: string | null }> {
  const [existing] = await db
    .select()
    .from(sourceSyncCheckpointSchema)
    .where(eq(sourceSyncCheckpointSchema.sourceId, sourceId))
    .limit(1);
  const since = incremental ? (existing?.since ?? null) : null;
  const cursor = existing?.cursor ?? null;
  if (existing) {
    await db
      .update(sourceSyncCheckpointSchema)
      .set({ status: 'running', startedAt: new Date(), error: null })
      .where(eq(sourceSyncCheckpointSchema.id, existing.id));
  } else {
    await db.insert(sourceSyncCheckpointSchema).values({ orgId, sourceId, status: 'running' });
  }
  return { since, cursor };
}

/**
 * Finish a sync: record status, counts, and (on success) the new watermark.
 * @param sourceId
 * @param orgId
 * @param args
 * @param args.status
 * @param args.counts
 * @param args.watermark
 * @param args.cursor
 * @param args.error
 */
export async function finishSync(
  sourceId: number,
  orgId: string,
  args: { status: 'completed' | 'failed'; counts?: Record<string, number>; watermark?: Date; cursor?: string | null; error?: string },
): Promise<void> {
  await db
    .update(sourceSyncCheckpointSchema)
    .set({
      status: args.status,
      completedAt: new Date(),
      counts: args.counts ?? {},
      cursor: args.cursor ?? null,
      error: args.error ?? null,
      ...(args.status === 'completed' ? { since: args.watermark ?? null } : {}),
    })
    .where(and(
      eq(sourceSyncCheckpointSchema.orgId, orgId),
      eq(sourceSyncCheckpointSchema.sourceId, sourceId),
    ));
}

export async function runSync(opts: {
  orgId: string;
  sourceId: number;
  /** Incremental sync: fetch only docs newer than the last watermark; skip tombstoning. */
  incremental?: boolean;
  onProgress?: (event: { kind: 'fetched' | 'skipped' | 'error'; uri?: string; message?: string }) => void;
}): Promise<SyncResult> {
  const [row] = await db
    .select()
    .from(knowledgeSourceSchema)
    .where(eq(knowledgeSourceSchema.id, opts.sourceId))
    .limit(1);
  if (!row || row.orgId !== opts.orgId) {
    throw new Error(`source ${opts.sourceId} not found for org ${opts.orgId}`);
  }
  const config = row.configJson as Record<string, unknown> & { _connector?: string };
  const connectorSlug = config._connector;
  if (!connectorSlug) {
    throw new Error(`source ${opts.sourceId} has no _connector hint in config_json`);
  }
  const connector = getConnector(connectorSlug);
  if (!connector) {
    throw new Error(`source ${opts.sourceId} references unknown connector: ${connectorSlug}`);
  }

  const { since, cursor } = await beginSync(opts.sourceId, opts.orgId, !!opts.incremental);
  // Resolve decrypted credentials from the vault so token/OAuth connectors can
  // authenticate. Credentials are per-CONNECTOR, not per-source — one HubSpot
  // token serves the deals/contacts/companies sources alike — so look up by the
  // connector slug (config._connector), not the source slug. Undefined for
  // connectors that need none (e.g. `web`).
  const credentials = await getCredentialsForSource(opts.orgId, connectorSlug);
  const cutoff = new Date();
  const result: SyncResult = {
    sourceId: opts.sourceId,
    created: 0,
    updated: 0,
    unchanged: 0,
    tombstoned: 0,
    errors: 0,
  };
  let errorCount = 0;

  try {
    for await (const doc of connector.sync({
      sourceId: opts.sourceId,
      orgId: opts.orgId,
      config,
      credentials,
      since,
      cursor,
      onProgress: (e) => {
        if (e.kind === 'error') {
          errorCount += 1;
        }
        opts.onProgress?.(e);
      },
    })) {
      try {
        const r = await ingestDocument(
          { orgId: opts.orgId, sourceId: opts.sourceId, sourceSlug: row.slug },
          doc,
        );
        if (r.status === 'created') {
          result.created += 1;
        } else if (r.status === 'updated') {
          result.updated += 1;
        } else {
          result.unchanged += 1;
        }
      } catch (err) {
        result.errors += 1;
        opts.onProgress?.({
          kind: 'error',
          uri: doc.externalId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    result.errors += errorCount;

    // Full sync prunes deletes; an incremental run only sees changed docs, so
    // tombstoning there would wrongly delete everything it didn't re-fetch.
    if (!opts.incremental) {
      const { deleted } = await tombstoneMissing(
        { orgId: opts.orgId, sourceId: opts.sourceId, sourceSlug: row.slug },
        cutoff,
      );
      result.tombstoned = deleted;
    }
    await markSourceSynced(opts.sourceId);
    await finishSync(opts.sourceId, opts.orgId, {
      status: 'completed',
      counts: { created: result.created, updated: result.updated, unchanged: result.unchanged, tombstoned: result.tombstoned, errors: result.errors },
      watermark: cutoff,
    });
    return result;
  } catch (err) {
    await finishSync(opts.sourceId, opts.orgId, {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function listSources(orgId: string): Promise<Array<{
  id: number;
  slug: string;
  kind: string | null;
  config: Record<string, unknown>;
  lastSyncedAt: Date | null;
  enabled: string;
  createdAt: Date;
}>> {
  const rows = await db
    .select({
      id: knowledgeSourceSchema.id,
      slug: knowledgeSourceSchema.slug,
      kind: knowledgeSourceSchema.kind,
      configJson: knowledgeSourceSchema.configJson,
      lastSyncedAt: knowledgeSourceSchema.lastSyncedAt,
      enabled: knowledgeSourceSchema.enabled,
      createdAt: knowledgeSourceSchema.createdAt,
    })
    .from(knowledgeSourceSchema)
    .where(eq(knowledgeSourceSchema.orgId, orgId));
  return rows.map(r => ({
    id: r.id,
    slug: r.slug,
    kind: (r.configJson as Record<string, unknown>)?._connector as string ?? r.kind,
    config: r.configJson,
    lastSyncedAt: r.lastSyncedAt,
    enabled: r.enabled,
    createdAt: r.createdAt,
  }));
}

/**
 * Most-recent documents across the org's corpus — the Search page's default
 * result set (browse-before-you-search). Optional per-source filter; each row
 * carries the first chunk's opening text as a blurb.
 * @param orgId
 * @param opts
 * @param opts.sourceSlug
 * @param opts.limit
 * @param opts.allowedSourceSlugs
 */
export async function listRecentDocuments(
  orgId: string,
  opts: { sourceSlug?: string; limit?: number; allowedSourceSlugs?: string[] } = {},
): Promise<Array<{ id: number; title: string | null; uri: string | null; sourceSlug: string; updatedAt: Date | null; blurb: string | null }>> {
  const limit = Math.min(opts.limit ?? 25, 100);
  const rows = await db
    .select({
      id: knowledgeDocumentSchema.id,
      title: knowledgeDocumentSchema.title,
      uri: knowledgeDocumentSchema.uri,
      sourceSlug: knowledgeSourceSchema.slug,
      lastModifiedAt: knowledgeDocumentSchema.lastModifiedAt,
      ingestedAt: knowledgeDocumentSchema.ingestedAt,
    })
    .from(knowledgeDocumentSchema)
    .innerJoin(knowledgeSourceSchema, eq(knowledgeDocumentSchema.sourceId, knowledgeSourceSchema.id))
    .where(and(
      eq(knowledgeDocumentSchema.orgId, orgId),
      opts.sourceSlug ? eq(knowledgeSourceSchema.slug, opts.sourceSlug) : undefined,
      // Per-user connection ACL — restricted sources drop out of browse too.
      opts.allowedSourceSlugs ? inArray(knowledgeSourceSchema.slug, opts.allowedSourceSlugs) : undefined,
    ))
    .orderBy(sql`coalesce(${knowledgeDocumentSchema.lastModifiedAt}, ${knowledgeDocumentSchema.ingestedAt}) desc`)
    .limit(limit);
  if (rows.length === 0) {
    return [];
  }
  // First-chunk blurbs in one query (content lives on chunks, not documents).
  const ids = rows.map(r => r.id);
  const chunks = await db.execute(sql`
    select document_id, left(content, 220) as blurb
    from knowledge_chunk
    where document_id in (${sql.join(ids.map(i => sql`${i}`), sql`, `)}) and chunk_idx = 0
  `);
  const blurbs = new Map<number, string>();
  for (const c of ((chunks as unknown as { rows?: Array<{ document_id: number; blurb: string }> }).rows ?? (chunks as unknown as Array<{ document_id: number; blurb: string }>))) {
    blurbs.set(Number(c.document_id), c.blurb);
  }
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    uri: r.uri,
    sourceSlug: r.sourceSlug,
    updatedAt: r.lastModifiedAt ?? r.ingestedAt,
    blurb: blurbs.get(r.id) ?? null,
  }));
}

/**
 * Ingested-document count per source for an org — powers the Sources UI's
 * "N documents" so you can see what each connector actually pulled.
 * @param orgId
 */
export async function documentCountsForOrg(orgId: string): Promise<Record<number, number>> {
  const rows = await db
    .select({ sourceId: knowledgeDocumentSchema.sourceId, count: sql<number>`count(*)::int` })
    .from(knowledgeDocumentSchema)
    .where(eq(knowledgeDocumentSchema.orgId, orgId))
    .groupBy(knowledgeDocumentSchema.sourceId);
  const map: Record<number, number> = {};
  for (const r of rows) {
    map[r.sourceId] = Number(r.count);
  }
  return map;
}

/**
 * Fetch a single org-scoped source by id — used by the credentials route to
 * resolve the connector slug (`config._connector`) before storing a token.
 * @param orgId
 * @param sourceId
 */
export async function getSourceById(orgId: string, sourceId: number): Promise<
  { id: number; slug: string; kind: string | null; config: Record<string, unknown> } | null
> {
  const [row] = await db
    .select({
      id: knowledgeSourceSchema.id,
      slug: knowledgeSourceSchema.slug,
      kind: knowledgeSourceSchema.kind,
      configJson: knowledgeSourceSchema.configJson,
    })
    .from(knowledgeSourceSchema)
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.id, sourceId)))
    .limit(1);
  if (!row) {
    return null;
  }
  return { id: row.id, slug: row.slug, kind: row.kind, config: row.configJson ?? {} };
}

function generateSlug(kind: string, config: Record<string, unknown>): string {
  // Pick a stable, human-readable slug derived from the config when
  // we can — falls back to a kind-prefixed timestamp otherwise.
  const cfg = config as { urls?: string[]; crawl?: { startUrl?: string } };
  const seed = cfg.crawl?.startUrl ?? cfg.urls?.[0];
  if (seed) {
    try {
      const host = new URL(seed).hostname.replace(/\W+/g, '-');
      return `${kind}-${host}`.slice(0, 60);
    } catch {
      /* fall through */
    }
  }
  return `${kind}-${Date.now()}`;
}
