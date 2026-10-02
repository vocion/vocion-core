/**
 * The two passes that keep image artifacts' bytes in Vocion after the write
 * that created them — see `libs/tools/artifacts/ingest.ts` for why.
 *
 *  - **Backfill** (`npm run artifacts:keep-images`): rows written before
 *    copies were kept, whose `url` is still someone else's link. Dry run by
 *    default — it reads the rows and reports what it would try, and fetches
 *    nothing. `--apply` copies. Idempotent: a copied row's `url` is in the
 *    store, so a second run does not select it.
 *  - **Sweep** (hourly durable schedule): rows whose copy `failed` for a
 *    reason that might not hold next time, retried while the link is still
 *    valid and under the attempt cap. A refusal (not an image, not public,
 *    too large) or an expired link is never retried.
 *
 * Both write through `retryArtifactImageIngest`, so a kept copy is always a
 * new version by `system` and a failure always records why.
 */

import type { ArtifactIngest, IngestDeps } from '@/libs/tools/artifacts/ingest';
import { and, asc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { presignedExpiry, shouldRetryIngest } from '@/libs/tools/artifacts/ingest';
import { artifactSchema } from '@/models/Schema';
import { retryArtifactImageIngest } from '@/services/ArtifactService';

export type KeepImagesCounts = {
  /** Rows selected: an external `url`, never copied or a retryable failure. */
  candidates: number;
  /** Dry run: would be fetched (the link has not expired, or does not say). */
  wouldTry: number;
  /** Links already past their presigned expiry — nothing left to copy. */
  expired: number;
  /** Links that name a video, which is not an image to keep. */
  videos: number;
  /** Apply: copied into the store. */
  stored: number;
  /** Apply: refused or failed; the reason is on the row's `ingest`. */
  failed: number;
};

type Candidate = { id: number; orgId: string; url: string | null; ingest: ArtifactIngest | null };

const VIDEO = /\.(?:webm|mp4|mov|m4v)(?:\?|$)|response-content-type=video%2F|response-content-type=video\//i;

async function selectCandidates(opts: { orgId?: string; afterId: number; limit: number }): Promise<Candidate[]> {
  return db
    .select({ id: artifactSchema.id, orgId: artifactSchema.orgId, url: artifactSchema.url, ingest: artifactSchema.ingest })
    .from(artifactSchema)
    .where(and(
      sql`${artifactSchema.url} ~* '^https?://'`,
      or(isNull(artifactSchema.ingest), sql`${artifactSchema.ingest}->>'status' = 'failed'`),
      gt(artifactSchema.id, opts.afterId),
      opts.orgId ? eq(artifactSchema.orgId, opts.orgId) : undefined,
    ))
    .orderBy(asc(artifactSchema.id))
    .limit(opts.limit);
}

/**
 * Copy the bytes of every image artifact still pointing at an external link.
 * @param opts - What to do.
 * @param opts.apply - Copy. Without it, report and change nothing.
 * @param opts.orgId - One workspace; every workspace when omitted.
 * @param opts.ids - Only these artifact ids (still subject to the selection).
 * @param opts.now - The clock, for tests.
 * @param opts.deps - Fetch and store seams, for tests.
 * @param opts.log - One line per row.
 */
export async function keepExistingImages(opts: { apply: boolean; orgId?: string; ids?: number[]; now?: Date; deps?: IngestDeps; log?: (line: string) => void }): Promise<KeepImagesCounts> {
  const now = opts.now ?? new Date();
  const counts: KeepImagesCounts = { candidates: 0, wouldTry: 0, expired: 0, videos: 0, stored: 0, failed: 0 };
  const only = opts.ids && opts.ids.length > 0 ? new Set(opts.ids) : null;
  let afterId = 0;
  for (;;) {
    const page = await selectCandidates({ orgId: opts.orgId, afterId, limit: 200 });
    if (page.length === 0) {
      break;
    }
    afterId = page[page.length - 1]!.id;
    for (const row of page) {
      if (only && !only.has(row.id)) {
        continue;
      }
      if (row.ingest && !shouldRetryIngest(row.ingest, now)) {
        continue;
      }
      counts.candidates += 1;
      const url = row.url!;
      if (VIDEO.test(url)) {
        counts.videos += 1;
        opts.log?.(`#${row.id} video, not an image — left as it is`);
        continue;
      }
      const expiry = presignedExpiry(url);
      if (expiry && expiry.getTime() <= now.getTime()) {
        counts.expired += 1;
        opts.log?.(`#${row.id} link expired ${expiry.toISOString()} — nothing left to copy`);
        if (opts.apply) {
          // Recorded, so the row says why its picture is gone and is never selected again.
          await retryArtifactImageIngest({ orgId: row.orgId, id: row.id, deps: { ...opts.deps, now } });
        }
        continue;
      }
      if (!opts.apply) {
        counts.wouldTry += 1;
        opts.log?.(`#${row.id} would copy (${expiry ? `link valid until ${expiry.toISOString()}` : 'link names no expiry'})`);
        continue;
      }
      const result = await retryArtifactImageIngest({ orgId: row.orgId, id: row.id, deps: { ...opts.deps, now } });
      if (result.status === 'stored') {
        counts.stored += 1;
        opts.log?.(`#${row.id} copied into the store`);
      } else if (result.status !== 'skipped') {
        counts.failed += 1;
        opts.log?.(`#${row.id} ${result.status}: ${result.reason ?? ''}`);
      }
    }
  }
  return counts;
}

/**
 * The hourly sweep: retry copies that failed for a reason that may not hold
 * now, while their links are still valid. Rows never tried are the
 * backfill's, not the sweep's — a deploy never copies a workspace's history
 * without someone having run the dry run first.
 * @param opts - Seams for tests.
 * @param opts.now - The clock.
 * @param opts.deps - Fetch and store seams.
 */
export async function sweepFailedImageIngests(opts: { now?: Date; deps?: IngestDeps } = {}): Promise<{ retried: number; stored: number }> {
  const now = opts.now ?? new Date();
  const rows = await db
    .select({ id: artifactSchema.id, orgId: artifactSchema.orgId, ingest: artifactSchema.ingest })
    .from(artifactSchema)
    .where(and(sql`${artifactSchema.ingest}->>'status' = 'failed'`, sql`${artifactSchema.url} ~* '^https?://'`))
    .orderBy(asc(artifactSchema.id))
    .limit(500);
  let retried = 0;
  let stored = 0;
  for (const row of rows) {
    if (!shouldRetryIngest(row.ingest, now)) {
      continue;
    }
    retried += 1;
    const result = await retryArtifactImageIngest({ orgId: row.orgId, id: row.id, deps: { ...opts.deps, now } });
    if (result.status === 'stored') {
      stored += 1;
    }
  }
  return { retried, stored };
}
