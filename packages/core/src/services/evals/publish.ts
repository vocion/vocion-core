/**
 * Keeping a dataset's cases in step with the grader that holds them.
 *
 * Only some graders keep a dataset of their own — ours holds the cases in
 * Postgres and has nothing to publish — so this asks the provider whether it
 * can publish rather than asking which provider it is. A third grader is a new
 * module and a `publishDataset`, not an edit here.
 *
 * Two decisions are worth keeping in view:
 *
 * - **A failed publish does not cost anyone a run.** Scoring never reads the
 *   published dataset; AgentCore's `Evaluate` carries the expected answer, the
 *   assertions and the expected trajectory in the request body, and
 *   reproducibility comes from `eval_run.datasetVersion`. So the failure is
 *   written down, the page says the eval is not synced, and the cases run.
 *   This is the same answer the evaluator sync already gives, for the same
 *   reason: measuring nothing is the bigger loss.
 * - **One publisher at a time per dataset.** While AWS is applying a change
 *   the dataset is `UPDATING` and every other write is refused, so a schedule
 *   firing next to a hand-pressed run would leave a half-applied Draft. The
 *   advisory lock below makes the second one skip publishing and run anyway
 *   rather than queue behind an AWS round trip.
 */

import type { EvalScoreProvider } from './providers/types';
import type { EvalDatasetItem } from './types';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { evalDatasetRemoteSchema } from '@/models/Schema';
import { casesHashFor } from './providers/agentcoreDatasets';

/** What the run records about where its cases live. */
export type DatasetSyncResult = {
  /** The grader's id for the dataset, when it has one. */
  remoteId: string | null;
  /** The version the grader last published. */
  remoteVersion: string | null;
  /** Set when the last publish failed; the run still happened. */
  syncError: string | null;
  /** True when this call actually sent something. */
  published: boolean;
};

/** The dataset fields a publish needs. */
export type PublishableDataset = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  items: EvalDatasetItem[];
};

/**
 * A lock key Postgres can hold for one dataset.
 *
 * `hashtext` rather than the id itself, so the advisory lock space cannot
 * collide with another feature that happens to lock on a small integer.
 * @param datasetId - Which dataset.
 */
function lockKeyFor(datasetId: number): string {
  return `eval-dataset-publish:${datasetId}`;
}

/**
 * The remote row for this dataset and grader, creating it on first use.
 * @param orgId - Whose workspace.
 * @param datasetId - Which dataset.
 * @param providerId - Which grader.
 */
async function remoteRowFor(orgId: string, datasetId: number, providerId: string) {
  const [existing] = await db
    .select()
    .from(evalDatasetRemoteSchema)
    .where(and(
      eq(evalDatasetRemoteSchema.datasetId, datasetId),
      eq(evalDatasetRemoteSchema.provider, providerId),
    ));
  if (existing) {
    return existing;
  }
  const [created] = await db
    .insert(evalDatasetRemoteSchema)
    .values({ orgId, datasetId, provider: providerId })
    .returning();
  return created!;
}

/**
 * Make sure the grader is holding the cases this dataset currently declares.
 *
 * Usually does nothing at all: the hash of the published content is compared
 * first, so an unchanged dataset on a nightly schedule makes no AWS calls.
 * @param orgId - Whose workspace.
 * @param dataset - The dataset and its cases.
 * @param provider - The grader this dataset names.
 */
export async function syncDatasetToProvider(
  orgId: string,
  dataset: PublishableDataset,
  provider: EvalScoreProvider,
): Promise<DatasetSyncResult | null> {
  if (!provider.publishDataset) {
    return null;
  }

  const row = await remoteRowFor(orgId, dataset.id, provider.id);
  const hash = casesHashFor(dataset.items, dataset.slug);
  if (row.remoteId && row.casesHash === hash && !row.syncError) {
    return {
      remoteId: row.remoteId,
      remoteVersion: row.remoteVersion,
      syncError: null,
      published: false,
    };
  }

  const key = lockKeyFor(dataset.id);
  const locked = await takeLock(key);
  if (!locked) {
    // Another run is publishing this dataset right now. Waiting would hold a
    // run open behind someone else's AWS round trip for a mirror the scoring
    // does not read.
    console.error(`[evals] ${dataset.slug} is being published by another run; scoring against the cases we have`);
    return {
      remoteId: row.remoteId,
      remoteVersion: row.remoteVersion,
      syncError: row.syncError,
      published: false,
    };
  }

  try {
    const published = await provider.publishDataset({
      orgId,
      datasetSlug: dataset.slug,
      datasetName: dataset.name,
      description: dataset.description,
      items: dataset.items,
      remoteId: row.remoteId,
    });
    await db
      .update(evalDatasetRemoteSchema)
      .set({
        remoteId: published.remoteId,
        remoteVersion: published.remoteVersion,
        status: published.status,
        casesHash: hash,
        syncError: null,
        syncedAt: new Date(),
      })
      .where(eq(evalDatasetRemoteSchema.id, row.id));
    return {
      remoteId: published.remoteId,
      remoteVersion: published.remoteVersion,
      syncError: null,
      published: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[evals] could not publish ${dataset.slug} to ${provider.id}`, error);
    // The hash is deliberately left alone: a publish that failed partway must
    // be resent in full next time, not treated as landed.
    await db
      .update(evalDatasetRemoteSchema)
      .set({ syncError: message, status: 'error', syncedAt: new Date() })
      .where(eq(evalDatasetRemoteSchema.id, row.id));
    return {
      remoteId: row.remoteId,
      remoteVersion: row.remoteVersion,
      syncError: message,
      published: false,
    };
  } finally {
    await releaseLock(key);
  }
}

/**
 * Try to become the one publisher for this dataset.
 *
 * Session-level rather than transactional, because the work it guards is a
 * sequence of AWS calls and no transaction may be held open across those.
 * @param key - The lock key.
 */
async function takeLock(key: string): Promise<boolean> {
  try {
    const result = await db.execute(sql`select pg_try_advisory_lock(hashtext(${key})) as locked`);
    const rows = ((result as { rows?: Array<{ locked?: boolean }> }).rows ?? result) as Array<{ locked?: boolean }>;
    return rows[0]?.locked !== false;
  } catch (error) {
    // A database without advisory locks must not stop evals running; the worst
    // case is the collision this was avoiding, which AWS itself then refuses.
    console.error('[evals] could not take the publish lock', error);
    return true;
  }
}

/**
 * Let the next publisher in.
 * @param key - The lock key.
 */
async function releaseLock(key: string): Promise<void> {
  try {
    await db.execute(sql`select pg_advisory_unlock(hashtext(${key}))`);
  } catch (error) {
    console.error('[evals] could not release the publish lock', error);
  }
}
