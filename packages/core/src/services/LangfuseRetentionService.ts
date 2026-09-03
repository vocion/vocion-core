/**
 * LangfuseRetentionService — deletes traces older than
 * `LANGFUSE_RETENTION_DAYS`.
 *
 * Why this exists rather than a Langfuse setting: Langfuse has no
 * environment variable for retention, and its own project-level
 * retention is an Enterprise feature on self-hosted instances
 * (langfuse.com/pricing-self-host, checked 2026-09-03). A self-hosted
 * open-source instance therefore keeps every trace forever, on a
 * ClickHouse volume that shares a disk with the application database.
 * Growth tracks LLM call volume, and an ingestion agent generates a lot
 * of it, so "forever" eventually means the app runs out of disk.
 *
 * This does the pruning through the public API with the project keys
 * already in the environment — no Enterprise licence, no
 * organisation-scoped key, and it works the same on Langfuse Cloud:
 *
 *   GET    /api/public/traces?toTimestamp=<cutoff>&page=&limit=
 *   DELETE /api/public/traces  { traceIds: [...] }
 *
 * Deleting a trace deletes its observations and scores with it, so
 * there is nothing to clean up separately.
 *
 * Runs on a daily Temporal schedule — see
 * `services/temporal/workflows/langfuseRetention.ts`. Nothing calls it
 * on the request path.
 */

import type { LangfuseEnabled } from '@/libs/Langfuse/config';
import { Buffer } from 'node:buffer';
import { langfuseConfig } from '@/libs/Langfuse';
import { logger } from '@/libs/Logger';

/** Traces per list request. Langfuse's own docs suggest lowering this if a page times out. */
const TRACES_PER_PAGE = 100;

/** Trace ids per delete request, so one failure costs at most this many. */
const DELETE_BATCH_SIZE = 50;

/**
 * Stop after this many pages in a single run.
 *
 * The first run against an instance that has never been pruned could
 * face millions of traces. A cap keeps one run bounded — the schedule
 * fires again tomorrow, and the backlog drains over a few days instead
 * of one run hammering ClickHouse for hours.
 */
const MAX_PAGES_PER_RUN = 200;

export type PruneResult = {
  /** Traces deleted in this run. */
  deleted: number;
  /** True when the page cap stopped the run before the backlog was clear. */
  moreRemaining: boolean;
  /** The age boundary used, so the caller can log what was actually applied. */
  cutoff: string;
};

type TraceListResponse = {
  data: Array<{ id: string }>;
  meta?: { totalPages?: number };
};

/**
 * Basic-auth header from the project keys. Langfuse authenticates the
 * public API with the same public/secret pair the SDK uses.
 * @param config - Resolved Langfuse configuration.
 */
function authorizationHeader(config: LangfuseEnabled): string {
  const encoded = Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64');
  return `Basic ${encoded}`;
}

/**
 * The timestamp traces must predate to be deleted.
 * @param retentionDays - How many days of traces to keep.
 * @param now - Current time, injectable so tests do not depend on the clock.
 */
export function retentionCutoff(retentionDays: number, now: Date = new Date()): string {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  return cutoff.toISOString();
}

/**
 * Fetch one page of traces older than the cutoff.
 *
 * Always asks for page 1: the previous page's traces have been deleted
 * by the time the next request goes out, so paging forward would skip
 * over the ones that shifted down into the gap.
 * @param config - Resolved Langfuse configuration.
 * @param cutoff - ISO 8601 timestamp; only traces before this are returned.
 */
async function fetchExpiredTraceIds(config: LangfuseEnabled, cutoff: string): Promise<string[]> {
  const url = new URL('/api/public/traces', config.baseUrl);
  url.searchParams.set('toTimestamp', cutoff);
  url.searchParams.set('page', '1');
  url.searchParams.set('limit', String(TRACES_PER_PAGE));

  const response = await fetch(url, {
    headers: {
      'Authorization': authorizationHeader(config),
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Langfuse trace list failed: ${response.status} ${body.slice(0, 200)}`);
  }

  const payload = await response.json() as TraceListResponse;
  return payload.data.map(trace => trace.id);
}

/**
 * Delete one batch of traces. Their observations and scores go too.
 * @param config - Resolved Langfuse configuration.
 * @param traceIds - Ids to delete; at most DELETE_BATCH_SIZE of them.
 */
async function deleteTraces(config: LangfuseEnabled, traceIds: string[]): Promise<void> {
  const response = await fetch(new URL('/api/public/traces', config.baseUrl), {
    method: 'DELETE',
    headers: {
      'Authorization': authorizationHeader(config),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ traceIds }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Langfuse trace delete failed: ${response.status} ${body.slice(0, 200)}`);
  }
}

/**
 * Split a list into fixed-size chunks.
 * @param items - List to split.
 * @param size - Maximum chunk length.
 */
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Delete every trace older than the configured retention period.
 *
 * A no-op when tracing is off, or when `LANGFUSE_RETENTION_DAYS` is 0,
 * so the schedule can fire on any deployment without a guard at the
 * call site. Unset means one year, not off.
 * @param now - Current time, injectable for tests.
 */
export async function pruneExpiredTraces(now: Date = new Date()): Promise<PruneResult | null> {
  const config = langfuseConfig();

  if (!config.enabled) {
    logger.info('Langfuse retention skipped: tracing is off', { reason: config.reason });
    return null;
  }
  if (config.retentionDays === null) {
    logger.info('Langfuse retention skipped: LANGFUSE_RETENTION_DAYS is 0, so traces are kept indefinitely by request');
    return null;
  }

  const cutoff = retentionCutoff(config.retentionDays, now);
  let deleted = 0;

  for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
    const expiredTraceIds = await fetchExpiredTraceIds(config, cutoff);
    if (expiredTraceIds.length === 0) {
      logger.info('Langfuse retention complete', {
        deleted,
        cutoff,
        retentionDays: config.retentionDays,
      });
      return { deleted, moreRemaining: false, cutoff };
    }

    for (const batch of chunk(expiredTraceIds, DELETE_BATCH_SIZE)) {
      await deleteTraces(config, batch);
      deleted += batch.length;
    }
  }

  // Hit the page cap. Not an error: tomorrow's run continues from here.
  logger.info('Langfuse retention stopped at the per-run page limit; the rest is deleted on the next run', {
    deleted,
    cutoff,
    retentionDays: config.retentionDays,
    maxPagesPerRun: MAX_PAGES_PER_RUN,
  });
  return { deleted, moreRemaining: true, cutoff };
}
