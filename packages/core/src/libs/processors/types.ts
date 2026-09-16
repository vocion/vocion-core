/**
 * DocumentProcessor, the shape of a per-document stage that runs AFTER a
 * document has been ingested.
 *
 * A connector's job ends when a document is saved. Some workspaces need one
 * more step on top of that: read what just landed and turn it into structured
 * work, a proposal, a card, a candidate for review. That step is per tenant,
 * usually expensive, and must never be able to fail an ingest, so it is a
 * separate contract rather than something bolted onto `SourceConnector`.
 *
 * Three rules the runner enforces, which is why they are not restated in every
 * processor:
 *
 *   - **A processor never fails a sync.** `SourceSyncService` wraps `run()` in
 *     its own try/catch, counts failures under their own `processor` scope, and
 *     leaves `counts.errors`, which gates tombstoning and the watermark, alone.
 *   - **It only runs for the outcomes it asks for.** `runsOn` defaults to
 *     created and updated, so an unchanged document costs nothing.
 *   - **It spends from one shared budget.** Every processor invocation in a
 *     sync shares the same `SyncBudget`, because they run eight at a time.
 *
 * The registry (`./registry`) keeps the config schema eager and the `run`
 * implementation behind a dynamic import, so nothing here drags a model client
 * into the Temporal worker's static import graph.
 */

import type { z } from 'zod';
import type { SyncBudget } from './budget';
import type { IngestDoc, IngestResult } from '@/services/IngestionService';

/** Ingest outcomes a processor can ask to run for. */
export type ProcessorRunsOn = IngestResult['status'];

/**
 * What a processor runs for when it does not say. An unchanged document has
 * the same content it had last run, so re-processing it buys nothing.
 */
export const DEFAULT_RUNS_ON: ProcessorRunsOn[] = ['created', 'updated'];

/**
 * Anything a processor wants to keep for the length of one sync, rather than
 * per document: a known-cards block loaded once, a resolved lookup table. The
 * runner creates one of these per run and hands the same object to every
 * invocation, so a cache here is shared by the eight documents in flight.
 */
export type ProcessorSyncContext = {
  cache: Map<string, unknown>;
};

/**
 * Progress a processor reports as it works.
 *
 * Deliberately narrower than the connector's event: there is no `error` kind.
 * A processor reports a failure by throwing (the runner counts it under
 * `processorErrors`) or by returning it in `skipped`; letting it emit an error
 * event would put processor trouble into the run's ingest error total, which
 * is what decides whether documents get tombstoned.
 */
export type ProcessorProgressEvent = {
  kind: 'fetched' | 'skipped';
  uri?: string;
  message?: string;
};

export type ProcessorRunContext<TConfig = unknown> = {
  orgId: string;
  sourceId: number;
  sourceSlug: string;
  /** The document as the connector yielded it. */
  document: IngestDoc;
  /** What ingesting it did, created, updated, or unchanged. */
  outcome: IngestResult;
  /** This source's processor config, already parsed by `configSchema`. */
  config: TConfig;
  /** The whole sync's spending limits. Take a slot before doing the work. */
  budget: SyncBudget;
  /** Shared across every invocation in this sync. */
  syncContext: ProcessorSyncContext;
  /**
   * Aborts when this document's processor has run out of time. Pass it to
   * fetches and model calls: the runner stops waiting either way, and without
   * the signal the abandoned work carries on spending money.
   */
  signal: AbortSignal;
  onProgress: (event: ProcessorProgressEvent) => void;
};

export type ProcessorResult = {
  /** How many things this document produced, proposals, records, rows. */
  produced: number;
  /** How many it deliberately did not produce, for any reason. */
  skipped: number;
  /** Anything worth reading back, one short line each. */
  notes?: string[];
  /**
   * Extra numeric counters for the run's checkpoint, merged under the
   * `extract.` prefix. Numbers only: `source_sync_checkpoint.counts` is typed
   * `Record<string, number>`, so anything else cannot be stored.
   */
  counts?: Record<string, number>;
};

export type DocumentProcessor<TConfig = unknown> = {
  /** Stable slug, as written in a source manifest's `processor.slug`. */
  slug: string;
  /** Human label. */
  name: string;
  /** One line saying what it does to a document. */
  description: string;
  /** Validates the tenant's `processor.config` blob at apply time and at run start. */
  configSchema: z.ZodTypeAny;
  /** Ingest outcomes to run for. `DEFAULT_RUNS_ON` when omitted. */
  runsOn?: ProcessorRunsOn[];
  /**
   * How long ONE document may take before the runner stops waiting for it.
   * Omitted, the runner's generic default applies.
   *
   * It belongs to the processor because only the processor knows what its
   * document costs: a generic cap is either too tight for the expensive one
   * (every extraction abandoned mid-model-call) or too loose for the cheap
   * one. Declared here, in the eager half, so the runner can read it without
   * loading `run` and the model client behind it.
   */
  documentTimeoutMs?: number;
  run: (ctx: ProcessorRunContext<TConfig>) => Promise<ProcessorResult>;
};

export type { SyncBudget };
