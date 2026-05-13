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

import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { knowledgeSourceSchema } from '@/models/Schema';
import { getConnector } from '@/libs/sources/registry';
import {
  ensureSource,
  ingestDocument,
  markSourceSynced,
  tombstoneMissing,
} from './IngestionService';

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

export async function runSync(opts: {
  orgId: string;
  sourceId: number;
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

  for await (const doc of connector.sync({
    sourceId: opts.sourceId,
    orgId: opts.orgId,
    config,
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

  // Tombstone documents the source didn't yield this run.
  const { deleted } = await tombstoneMissing(
    { orgId: opts.orgId, sourceId: opts.sourceId, sourceSlug: row.slug },
    cutoff,
  );
  result.tombstoned = deleted;
  await markSourceSynced(opts.sourceId);
  return result;
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
