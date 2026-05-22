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
 * and calls `ingestDocument` per yield, then `tombstoneMissing` at
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
  /** Optional progress callback — connectors call this between yields
   *  so the UI can show "12 / 47 documents". */
  onProgress?: (event: { kind: 'fetched' | 'skipped' | 'error'; uri?: string; message?: string }) => void;
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
  /** Zod schema validating the config_json blob the user enters when
   *  adding the source. The Add-Source form auto-generates inputs from
   *  the schema's field metadata. */
  configSchema: TConfigSchema;
  /**
   * Yield each document the source currently exposes. Order doesn't
   * matter; idempotency is handled by IngestionService's content-hash
   * dedup. Throw to abort the whole sync (rolls back nothing — partial
   * progress is intentional so a 1000-doc sync that fails on doc 487
   * still keeps the first 486).
   */
  sync: (ctx: SourceContext) => AsyncIterable<IngestDoc>;
};
