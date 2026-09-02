/**
 * SourceConnector — the plugin shape every data source implements.
 *
 * Designed so the same interface works for OAuth services (Drive,
 * GitHub), API-key services (Notion, HubSpot), and zero-auth crawlers
 * (web URLs, public RSS). The runtime owns chunking + embedding +
 * dedup via IngestionService; connectors just emit document records.
 *
 * Sync is modeled as an async iterator so memory stays bounded for
 * sources that walk millions of files (Drive folders, S3 buckets).
 * The orchestrator (`SourceSyncService.runSync`) loops the iterator
 * and calls `ingestDocument` per yield, then `deleteDocumentsGoneFromSource` at
 * the end to prune deleted upstream rows.
 */

import type { z } from 'zod';
import type { IngestDoc } from '@/services/IngestionService';

export type SourceAuthKind = 'none' | 'apikey' | 'oauth';

export type SourceContext = {
  /** The knowledge_source row id this run is scoped to. */
  sourceId: number;
  orgId: string;
  /** Resolved per-connector config (parsed via `configSchema`). */
  config: Record<string, unknown>;
  /** Decrypted credential bag, when `authKind !== 'none'`. */
  credentials?: Record<string, unknown>;
  /**
   * Incremental watermark for a durable/resumable sync. When set, connectors
   * SHOULD fetch only documents changed at/after this time (via upstream
   * `modifiedTime`/etag), falling back to a full walk when unsupported.
   */
  since?: Date | null;
  /** Opaque resume position from the prior run's checkpoint (connector-defined). */
  cursor?: string | null;
  /**
   * Optional progress callback — connectors call this between yields
   *  so the UI can show "12 / 47 documents".
   */
  onProgress?: (event: { kind: 'fetched' | 'skipped' | 'error'; uri?: string; message?: string }) => void;
};

/** What kind of value one CSV column holds, so a text cell can be coerced before validation. */
export type BulkImportColumnType = 'text' | 'number' | 'boolean' | 'list';

/**
 * One column of a connector's bulk-import CSV.
 *
 * `configPath` is a dotted path into the connector's config object, so
 * `crawl.maxPages` writes `{ crawl: { maxPages: 20 } }`. Connectors whose
 * config shape cannot be expressed as flat path assignments leave it off and
 * supply `buildConfig` instead.
 */
export type BulkImportColumn = {
  /** Header text in the template, e.g. `max_pages`. Lower snake case. */
  column: string;
  type: BulkImportColumnType;
  /** Whether a row with this cell empty is rejected. */
  required: boolean;
  /**
   * Dotted path into the config object this cell lands at.
   *
   * Also how a schema rejection is traced back to the column the operator
   * typed into. A connector with a `buildConfig` still declares it for that
   * reason — `buildConfig` decides what is written, `configPath` says where the
   * value ends up. Omitted only by a column that lands nowhere, such as a flag
   * choosing between two config shapes.
   */
  configPath?: string;
  /** The value written into the template's example row. */
  example: string;
};

/**
 * Opts a connector into CSV bulk import: one source per row, a downloadable
 * template, and a preview that validates every row before anything is written.
 *
 * The template, the cell coercion and the preview all read from this one
 * descriptor plus the connector's existing `configSchema`, so a connector
 * added later gets bulk import by declaring a descriptor and nothing else.
 */
export type BulkImportDescriptor = {
  /** Columns in template order. The `slug` column is prepended automatically. */
  columns: BulkImportColumn[];
  /**
   * The columns whose combined value identifies the source — used to name it
   * and to recognise a row that is already configured. All must be required
   * columns. Usually one (a URL, a channel id); more when a single column is
   * not enough on its own, as two Jira sources on the same site pulling
   * different projects are two different sources.
   *
   * The first column also seeds the generated slug.
   */
  identityColumns: string[];
  /**
   * Build one row's config when a flat column-to-path mapping cannot express
   * it (the web connector picks between a crawl and a single-URL fetch, say).
   * Receives the already-coerced cell values keyed by column name.
   */
  buildConfig?: (cells: Record<string, unknown>) => Record<string, unknown>;
  /**
   * Read the identity parts back out of a stored config, so an import can tell
   * that a row is already configured. One entry per `identityColumns` entry.
   * Defaults to reading each identity column's `configPath`.
   */
  identityFromConfig?: (config: Record<string, unknown>) => string[] | null;
};

export type SourceConnector<TConfigSchema extends z.ZodTypeAny = z.ZodTypeAny> = {
  /** Stable slug — `web`, `google-drive`, `github`. */
  slug: string;
  /** Human label for the UI. */
  name: string;
  /** One-line description rendered on the "Add source" picker. */
  description: string;
  /** Lucide icon name for the picker tile. */
  icon: string;
  authKind: SourceAuthKind;
  /**
   * Zod schema validating the config_json blob the user enters when
   *  adding the source. The Add-Source form auto-generates inputs from
   *  the schema's field metadata.
   */
  configSchema: TConfigSchema;
  /**
   * Default cron for a periodic FULL sync (a reconcile pass). Incremental
   * syncs can never observe upstream deletions — a deleted record simply
   * stops matching `updated >=` — so connectors whose upstream can delete
   * records should set this; the full run re-yields everything in scope and
   * the tombstone pass prunes the rest. Workspaces override (or disable)
   * per source via the manifest's `reconcileSchedule`.
   */
  defaultReconcileCron?: string;
  /**
   * Opts this connector into CSV bulk import. Omitted = the connector is
   * added one at a time only, which is right for anything needing an
   * interactive verification step (Strapi) or existing once per org (Zoom).
   */
  bulkImport?: BulkImportDescriptor;
  /**
   * Yield each document the source currently exposes. Order doesn't
   * matter; idempotency is handled by IngestionService's content-hash
   * dedup. Throw to abort the whole sync (rolls back nothing — partial
   * progress is intentional so a 1000-doc sync that fails on doc 487
   * still keeps the first 486).
   *
   * A connector that fetches several independent slices (Strapi's
   * collections, say) may instead catch a slice's failure, report it via
   * `onProgress({ kind: 'error' })`, and carry on with the rest — losing
   * one slice should not cost the others. SourceSyncService counts those
   * reports into `result.errors`, records them on the checkpoint for the
   * UI, and — importantly — suppresses tombstoning for the whole run,
   * since a slice we could not read is not a slice whose documents we can
   * safely call deleted.
   */
  sync: (ctx: SourceContext) => AsyncIterable<IngestDoc>;
};
