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
import type { InspectInput } from './inspect';
import type { IngestDoc } from '@/services/IngestionService';

export type SourceAuthKind = 'none' | 'apikey' | 'oauth';

/**
 * Whose credential a connector authenticates with.
 *
 * The distinction is not cosmetic: it decides whether one grant speaks for the
 * whole workspace or for one person, and therefore whether what the connector
 * returns may be ingested into shared retrieval at all.
 *
 *   - `shared` — HubSpot, Jira, Strapi, S3, Notion, web. One credential the
 *     workspace holds, connected once by an admin, and everything it reads is
 *     workspace content. Safe to ingest into `knowledge_chunk`.
 *   - `personal` — Gmail, Calendar, Drive. One grant per member, reaching that
 *     member's own mailbox or files. **Live-read only** — never synced, never
 *     chunked, never a row in `knowledge_document`. Ingesting a personal source
 *     would need an owner column plus an intersection on every retrieval path,
 *     and the failure mode of getting that wrong is a leak.
 *   - `either` — Zoom, Slack. Both readings are legitimate. The default is
 *     `personal`, because the first connection is then trivially safe; a
 *     workspace grant, when one exists, is offered as a second choice.
 */
export type SourceIdentity = 'shared' | 'personal' | 'either';

/**
 * The tier a connector resolves under, with `either` settled.
 *
 * `either` is a declaration, not a runtime state — every code path that gates
 * on the tier needs one of the two real answers, and the default is the safe
 * one (see `SourceIdentity`).
 */
export type ResolvedIdentity = 'shared' | 'personal';

/**
 * Settle a connector's declared identity into the tier it actually resolves
 * under. `either` defaults to `personal`: the first connection then grants only
 * the person who made it, and nobody is surprised by a tap that bound a
 * credential for the whole team.
 * @param identity - What the connector declared, if it declared anything.
 */
export function resolveIdentity(identity: SourceIdentity | undefined): ResolvedIdentity {
  return identity === 'shared' ? 'shared' : 'personal';
}

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
   * Whose credential this connector runs on — see `SourceIdentity`.
   *
   * Declared on the connector rather than decided globally, because the answer
   * is a property of what the third party exposes: a HubSpot private-app token
   * reads the company's CRM whoever holds it, and a Gmail grant reads exactly
   * one mailbox. Undeclared reads as `personal`, which is the safe default and
   * the one that cannot silently widen an existing grant.
   */
  identity?: SourceIdentity;
  /**
   * Minimum vendor scopes each agent tool needs, keyed by tool name.
   *
   * What the connect card asks for is derived from the tool the model was
   * about to call, not from a fixed list — so reading a calendar asks for
   * `calendar.readonly` and only a later write asks for the write scope. A
   * tool with no entry falls back to `default`.
   */
  scopes?: Record<string, readonly string[]>;
  /**
   * Zod schema validating the config_json blob the user enters when
   * adding the source.
   *
   * The Add-Source form does not read this schema directly — a zod schema
   * carries no wording — so a connector added here also needs an entry in
   * `configFields.ts` saying how to ask for each setting. A test pairs the two
   * so neither can drift from the other.
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
  /**
   * True for a connector that ingests nothing — Apollo is queried live at chat
   * time and mirrors nothing locally. Its `sync` still exists and yields no
   * documents, but the Sources page offers Test connection where a syncing
   * source offers Sync now: a Sync button that does nothing reads as a broken
   * source. Sync-less rows also take their connector slug verbatim, so the row
   * added by hand is the row a workspace manifest later adopts.
   */
  syncless?: boolean;
  /**
   * Look at the third party with candidate connection details, before any
   * source row or credential exists — what `POST /rpc/connectors/[slug]/inspect`
   * dispatches to. Persists nothing.
   *
   * Optional: a connector declaring none answers 501, and its Add-source dialog
   * falls back to its plain form. Throw `InspectInputError` for input the
   * connector cannot work with; the route answers 400 with the message.
   *
   * The return value is passed through verbatim, so a connector with a bespoke
   * renderer (Strapi's collection pick-list) keeps its own richer shape. Return
   * `ConnectorInspection` to get the generic checklist renderer.
   */
  inspect?: (input: InspectInput) => Promise<unknown>;
  /**
   * One line shown beside the Test connection button, BEFORE it is pressed.
   * For anything the test costs — Apollo's probe spends one credit on the
   * company-search check — so nobody spends it without being told.
   */
  inspectNote?: string;
};
