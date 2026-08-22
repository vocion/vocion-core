/**
 * SourceSyncService — drives a connector's `sync()` iterator and
 * pipes each yielded document through IngestionService. Centralized
 * here so connectors stay narrow (just iterate; don't worry about
 * chunking, embedding, dedup, deleting what's gone).
 *
 * Two entrypoints:
 *
 *   - `addSource()` — creates a knowledge_source row from a picker
 *     submission. Persists the config_json blob (validated against
 *     the connector's `configSchema`).
 *
 *   - `runSync()` — fetches the row, instantiates a SourceContext,
 *     iterates `connector.sync()`, ingests the documents it yields a
 *     few at a time, waits for those to finish, then calls
 *     `deleteDocumentsGoneFromSource`. Returns aggregated counts.
 *
 * Ingest processes up to `MAX_CONCURRENT_INGESTS` documents at a time.
 * Almost all of the time spent ingesting one document is spent waiting on a
 * single OpenAI embedding request, so handling them one at a time left a
 * large sync idle on the network for nearly its whole duration. Overlapping
 * a handful of documents reclaims that idle time.
 *
 * One consequence worth knowing: `onProgress` events now arrive
 * interleaved and can finish out of order. Consumers must not assume
 * documents are delivered one at a time.
 *
 * A sync still blocks its caller until it finishes, so a long crawl holds
 * a request open the whole time. Those belong on the Temporal path
 * (`services/temporal/activities/sourceSync.ts`) rather than the RPC route.
 */

import type { IngestDoc } from './IngestionService';
import { and, eq, inArray, lt, ne, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { getConnector } from '@/libs/sources/registry';
import { knowledgeDocumentSchema, knowledgeSourceSchema, sourceSyncCheckpointSchema } from '@/models/Schema';
import {
  deleteDocumentsGoneFromSource,
  ensureSource,
  ingestDocument,
  markSourceSynced,
} from './IngestionService';
import { getCredentialsForSource } from './SourceCredentialService';

/**
 * Log, loading the logger only when it's needed.
 *
 * `libs/Logger` has a top-level await, and this file sits in the import chain
 * of CLI scripts (`sync:source`, `ingest-docs`) that tsx compiles as CommonJS,
 * where a top-level await is fatal. Importing it normally breaks those scripts
 * outright. Same approach as `services/adoption/track.ts`.
 * @param level - How bad it is.
 * @param message - What happened, in plain words.
 * @param properties - Identifiers and context worth keeping.
 */
function log(level: 'warn' | 'error', message: string, properties: Record<string, unknown>): void {
  import('@/libs/Logger')
    .then(({ logger }) => logger[level](message, properties))
    // Nothing useful left to do if logging itself is broken.
    .catch(() => {});
}

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

/**
 * How many documents `runSync` ingests at the same time.
 *
 * Ingesting a document is almost entirely spent waiting on one OpenAI
 * embedding request, so doing them one at a time meant a 5,000-document sync
 * made 5,000 requests back to back — about 17 minutes, nearly all of it idle.
 *
 * Eight is a middle ground: enough to hide that waiting, not so many that we
 * run into OpenAI's rate limit or run out of database connections.
 *
 * Memory is the other reason not to raise this casually. Every document in
 * progress holds its full text, its chunks, and one 1,536-number vector per
 * chunk. A large document can run to a thousand chunks, so peak memory scales
 * directly with this number — eight big documents at once is on the order of a
 * hundred megabytes.
 */
export const MAX_CONCURRENT_INGESTS = 8;

export type SyncResult = {
  sourceId: number;
  created: number;
  updated: number;
  unchanged: number;
  /** Subset of `unchanged`: content identical, metadata rewritten. */
  metadataRefreshed: number;
  tombstoned: number;
  errors: number;
};

/**
 * How long a sync may sit marked as running before we assume its process died.
 *
 * Without a limit, a crashed or killed sync would leave the source marked busy
 * for good and nobody could ever sync it again. Thirty minutes matches the
 * timeout on the Temporal version of this job, so a run that is genuinely still
 * working is never mistaken for an abandoned one.
 */
const ABANDONED_SYNC_AFTER_MS = 30 * 60 * 1000;

/** Raised when a source is asked to sync while one of its syncs is running. */
export class SyncAlreadyRunningError extends Error {
  constructor(sourceId: number) {
    super(`a sync is already running for source ${sourceId}`);
    this.name = 'SyncAlreadyRunningError';
  }
}

/**
 * Claim the right to sync this source, and read where the last run got to.
 *
 * Only one sync per source may run at a time. Two at once would each pay OpenAI
 * to embed the same documents, and both would write to the one checkpoint row,
 * so whichever finished last would overwrite the other's record of what
 * happened.
 * @param sourceId - Source to claim.
 * @param orgId - Owning org.
 * @param incremental - Whether to return the previous run's watermark, so the
 * connector can ask the source only for what changed since then.
 * @throws SyncAlreadyRunningError when another sync currently holds this source.
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
    // Claim the source with a single conditional UPDATE, rather than checking
    // the status we just read and then writing.
    //
    // That distinction is the whole point. Reading first and deciding in here
    // leaves a gap: two requests can both read `completed`, both decide the
    // source is free, and both start syncing. Postgres would serialise the two
    // writes but neither asks a question, so both simply succeed.
    //
    // Putting the test inside the UPDATE moves the decision in under the row
    // lock. The second request waits for the first to commit, then re-checks
    // its WHERE against the newly committed row, sees `running`, and matches
    // nothing. Zero rows back is how it learns it lost. This also means the
    // rule holds across separate app processes, which no in-memory guard could.
    const takeoverCutoff = new Date(Date.now() - ABANDONED_SYNC_AFTER_MS);
    const claimed = await db
      .update(sourceSyncCheckpointSchema)
      .set({ status: 'running', startedAt: new Date(), error: null })
      .where(and(
        eq(sourceSyncCheckpointSchema.id, existing.id),
        or(
          ne(sourceSyncCheckpointSchema.status, 'running'),
          // A run marked running since before the cutoff had its process die;
          // otherwise the source could never be synced again.
          lt(sourceSyncCheckpointSchema.startedAt, takeoverCutoff),
        ),
      ))
      .returning({ id: sourceSyncCheckpointSchema.id });

    if (claimed.length === 0) {
      throw new SyncAlreadyRunningError(sourceId);
    }
    if (existing.status === 'running') {
      log('warn', 'took over a sync that appears to have been abandoned', {
        sourceId,
        orgId,
        startedMinutesAgo: Math.round((Date.now() - (existing.startedAt?.getTime() ?? 0)) / 60_000),
      });
    }
  } else {
    try {
      await db.insert(sourceSyncCheckpointSchema).values({ orgId, sourceId, status: 'running' });
    } catch (error) {
      // One checkpoint row per source, enforced by a unique index. Landing here
      // usually means another sync of this source inserted the row in the gap
      // between our read above and this write.
      const [nowExists] = await db
        .select({ id: sourceSyncCheckpointSchema.id })
        .from(sourceSyncCheckpointSchema)
        .where(eq(sourceSyncCheckpointSchema.sourceId, sourceId))
        .limit(1);
      if (nowExists) {
        log('warn', 'another sync claimed this source first', {
          sourceId,
          orgId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new SyncAlreadyRunningError(sourceId);
      }
      // Anything else is a real database problem and must not be disguised.
      log('error', 'could not record the start of a sync', {
        sourceId,
        orgId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
  /**
   * Incremental sync: ask the source only for documents changed since the last
   * run, and never delete anything (an incremental listing is not a full
   * picture of what the source holds).
   */
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
    metadataRefreshed: 0,
    tombstoned: 0,
    errors: 0,
  };
  /** What this run managed to do, as stored on the checkpoint row. */
  const countsForCheckpoint = () => ({
    created: result.created,
    updated: result.updated,
    unchanged: result.unchanged,
    metadataRefreshed: result.metadataRefreshed,
    tombstoned: result.tombstoned,
    errors: result.errors,
  });

  /**
   * Tell the caller what's happening, without letting it break the sync.
   *
   * These are progress notifications, so whoever is listening matters far less
   * than the work itself — a listener writing to a browser connection that has
   * since closed should not throw away minutes of syncing. Swallowing is
   * deliberate: the alternatives are failing a nearly-finished sync, or leaving
   * a rejected promise nobody handles, which crashes the process.
   * @param event - What just happened.
   * @param event.kind
   * @param event.uri
   * @param event.message
   */
  const reportProgress = (event: {
    kind: 'fetched' | 'skipped' | 'error';
    uri?: string;
    message?: string;
  }): void => {
    try {
      opts.onProgress?.(event);
    } catch (error) {
      // The listener is broken; the sync is not. Log it so a broken listener
      // is still findable, rather than disappearing.
      log('warn', 'sync progress listener threw', {
        sourceId: opts.sourceId,
        orgId: opts.orgId,
        eventKind: event.kind,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const activeIngests = new Set<Promise<void>>();

  // Document ids already handled in this run.
  //
  // A connector can yield the same document twice — a URL listed twice in the
  // source config, or a paginated API whose pages overlap by one item. Each
  // document only needs ingesting once per run, and doing it twice at the same
  // time actively breaks: `ingestDocument` checks whether the document already
  // exists before it spends time embedding, so both copies would find nothing,
  // both would insert, and the second would fail on the unique index.
  const handledExternalIds = new Set<string>();

  // Documents the source gave us that we then failed to save.
  //
  // These must survive the delete step at the end. The source still has them —
  // we just couldn't turn them into something searchable, usually because
  // OpenAI rate-limited us. Deleting them would take a document the customer
  // can plainly see in Drive and make it unfindable in search.
  const seenButNotSavedExternalIds = new Set<string>();

  // Errors the connector hit while listing or fetching, as opposed to errors
  // from saving a document. Any of these means we did not get a full picture of
  // what the source holds, so we must not delete anything on the strength of it.
  let connectorFailureCount = 0;

  /**
   * Start ingesting one document, and keep track of it until it finishes.
   *
   * A document that fails is counted in `result.errors` and otherwise
   * ignored, so one bad document never stops the rest of the sync.
   * @param doc - A document yielded by the connector.
   */
  const beginIngesting = (doc: IngestDoc): void => {
    const ingesting = ingestDocument(
      { orgId: opts.orgId, sourceId: opts.sourceId, sourceSlug: row.slug },
      doc,
    )
      .then((outcome) => {
        // No locking needed around these counters: JavaScript runs one piece
        // of code at a time, so two documents can never land on `+= 1` at once.
        if (outcome.status === 'created') {
          result.created += 1;
        } else if (outcome.status === 'updated') {
          result.updated += 1;
        } else {
          result.unchanged += 1;
          // Content identical but metadata rewritten — the shape a connector
          // field-widening backfill takes. Counted separately so such a run
          // is visible rather than reading as "nothing happened".
          if (outcome.metadataRefreshed) {
            result.metadataRefreshed += 1;
          }
        }
      })
      .catch((error) => {
        result.errors += 1;
        seenButNotSavedExternalIds.add(doc.externalId);
        // The counter alone loses the reason. Log it — a run full of rate-limit
        // failures and a run full of malformed documents need different fixes.
        log('warn', 'could not save a document during sync', {
          sourceId: opts.sourceId,
          orgId: opts.orgId,
          externalId: doc.externalId,
          error: error instanceof Error ? error.message : String(error),
        });
        reportProgress({
          kind: 'error',
          uri: doc.externalId,
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        activeIngests.delete(ingesting);
      });
    activeIngests.add(ingesting);
  };

  try {
    for await (const doc of connector.sync({
      sourceId: opts.sourceId,
      orgId: opts.orgId,
      config,
      credentials,
      since,
      cursor,
      onProgress: (e) => {
        // Errors the connector reports while fetching, counted alongside the
        // ones ingestion reports. Both end up in the same total.
        if (e.kind === 'error') {
          result.errors += 1;
          connectorFailureCount += 1;
        }
        reportProgress(e);
      },
    })) {
      if (handledExternalIds.has(doc.externalId)) {
        // Already ingested this document in this run — see handledExternalIds.
        reportProgress({
          kind: 'skipped',
          uri: doc.externalId,
          message: 'the connector yielded this document more than once',
        });
        continue;
      }
      handledExternalIds.add(doc.externalId);
      beginIngesting(doc);
      if (activeIngests.size >= MAX_CONCURRENT_INGESTS) {
        // Full. Wait for whichever document finishes first, which frees up a
        // slot for the next one. Not waiting for this document in particular.
        await Promise.race(activeIngests);
      }
    }
    // Wait for the documents that are still being ingested.
    //
    // The delete step below removes any document this run didn't see. A
    // document still being saved hasn't been marked as seen yet, so without
    // this wait it would get deleted and then written straight back — and in
    // between, search couldn't find it.
    //
    // allSettled, not all: `all` stops waiting the moment one document fails.
    // We want to wait for all of them either way.
    await Promise.allSettled(activeIngests);

    // Delete the documents the source no longer has.
    //
    // Only a full run can do this. An incremental run asks the source for
    // recent changes only, so almost nothing comes back and deleting on that
    // basis would wipe out the whole source.
    //
    // Even on a full run, only delete when we're confident we saw the real
    // contents of the source. Deleting is not recoverable from the customer's
    // point of view: the document stays in their Drive but disappears from
    // search, and nothing tells them. So when anything went wrong while
    // listing or fetching, leave everything alone. A document that lingers a
    // few hours too long is a far smaller problem than one that vanishes.
    if (!opts.incremental) {
      const listingLookedComplete = handledExternalIds.size > 0 && connectorFailureCount === 0;
      if (listingLookedComplete) {
        const { deleted } = await deleteDocumentsGoneFromSource(
          { orgId: opts.orgId, sourceId: opts.sourceId, sourceSlug: row.slug },
          cutoff,
          seenButNotSavedExternalIds,
        );
        result.tombstoned = deleted;
      } else {
        reportProgress({
          kind: 'skipped',
          message: handledExternalIds.size === 0
            ? 'the source returned no documents, so nothing was deleted'
            : `the source reported ${connectorFailureCount} failure(s), so nothing was deleted`,
        });
      }
    }
    await markSourceSynced(opts.sourceId);
    await finishSync(opts.sourceId, opts.orgId, {
      status: 'completed',
      counts: countsForCheckpoint(),
      watermark: cutoff,
    });
    return result;
  } catch (err) {
    // Wait here too, for the same reason.
    //
    // The connector can fail partway through — an expired token, a 500 from
    // the upstream API. That jumps straight to this block, skipping the wait
    // above. Without this, documents would carry on writing to the database
    // after the sync has been marked failed and the request has ended.
    await Promise.allSettled(activeIngests);
    log('error', 'sync failed', {
      sourceId: opts.sourceId,
      orgId: opts.orgId,
      connectorSlug,
      counts: countsForCheckpoint(),
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    // Record what did get through before the failure. runSync throws from
    // here, so these counts never reach the caller — the checkpoint row is
    // the only place you can see that, say, 1,200 documents were ingested
    // before the connector's token expired.
    await finishSync(opts.sourceId, opts.orgId, {
      status: 'failed',
      counts: countsForCheckpoint(),
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
    } catch (error) {
      // Not a parseable URL, so fall back to the timestamped name below. Worth
      // logging: it usually means the config holds something unexpected.
      log('warn', 'could not derive a source name from its config URL', {
        kind,
        seed,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return `${kind}-${Date.now()}`;
}
