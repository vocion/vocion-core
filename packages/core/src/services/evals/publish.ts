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
 *   lease below makes the second one skip publishing and run anyway rather
 *   than queue behind an AWS round trip.
 */

import type { EvalScoreProvider } from './providers/types';
import type { EvalDatasetItem } from './types';
import { createHash } from 'node:crypto';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { evalDatasetRemoteSchema } from '@/models/Schema';

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
 * How long one publisher may hold a dataset before another may take it.
 *
 * Long enough for AWS to apply a large diff and settle a version, short enough
 * that a process killed mid-publish does not keep a dataset from ever being
 * republished. A lease that expires under a publisher still working is the
 * case AWS itself refuses, which is the outcome the lease was avoiding anyway.
 */
const PUBLISH_LEASE_MS = 15 * 60 * 1000;

/**
 * What the grader is holding, as one string, whoever the grader is.
 *
 * Covers the cases and the slug they are addressed by, and nothing else, so
 * renaming a dataset's description does not cut a new version in someone's
 * account while changing a single expected answer does.
 *
 * Deliberately not the provider's own serialization: this module decides
 * whether anything needs republishing for every grader, and reaching into one
 * grader's request shape to answer that would make the next grader either
 * adopt AWS's wire format or add a branch here.
 * @param items - The authored cases.
 * @param slug - The dataset they belong to.
 */
export function casesFingerprint(items: EvalDatasetItem[], slug: string): string {
  const cases = items.map(item => ({
    input: item.input,
    expectedOutput: item.expectedOutput ?? null,
    expectedTrajectory: item.expectedTrajectory ?? [],
    assertions: item.assertions ?? [],
    rubric: item.rubric ?? null,
  }));
  return createHash('sha256').update(JSON.stringify({ slug, cases })).digest('hex');
}

/**
 * The remote row for this dataset and grader, creating it on first use.
 * @param orgId - Whose workspace.
 * @param datasetId - Which dataset.
 * @param providerId - Which grader.
 */
async function remoteRowFor(orgId: string, datasetId: number, providerId: string) {
  const [existing] = await selectRemoteRow(orgId, datasetId, providerId);
  if (existing) {
    return existing;
  }
  // A schedule and a hand-pressed run reach this together on a dataset nobody
  // has published yet: both read nothing, both insert, and one loses the unique
  // index on (dataset, provider). Losing that race is not an error worth
  // raising — the row the winner wrote is the row this caller wanted.
  const [created] = await db
    .insert(evalDatasetRemoteSchema)
    .values({ orgId, datasetId, provider: providerId })
    .onConflictDoNothing()
    .returning();
  if (created) {
    return created;
  }
  const [winner] = await selectRemoteRow(orgId, datasetId, providerId);
  return winner!;
}

/**
 * The publish row for one dataset and grader, scoped to the org that owns it.
 *
 * The org filter is belt and braces: every caller has already resolved the
 * dataset through an org-scoped read. It costs nothing and means a future
 * caller that forgets cannot read across tenants.
 * @param orgId - Whose workspace.
 * @param datasetId - Which dataset.
 * @param providerId - Which grader.
 */
async function selectRemoteRow(orgId: string, datasetId: number, providerId: string) {
  return db
    .select()
    .from(evalDatasetRemoteSchema)
    .where(and(
      eq(evalDatasetRemoteSchema.orgId, orgId),
      eq(evalDatasetRemoteSchema.datasetId, datasetId),
      eq(evalDatasetRemoteSchema.provider, providerId),
    ));
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

  // Everything before the publish call can fail too — the row may lose an
  // insert race, and a case with no input has no fingerprint — and this whole
  // function exists on the promise that a publish problem never costs a run.
  // So the preparation is guarded exactly like the AWS call is.
  let row: Awaited<ReturnType<typeof remoteRowFor>>;
  let hash: string;
  try {
    row = await remoteRowFor(orgId, dataset.id, provider.id);
    hash = casesFingerprint(dataset.items, dataset.slug);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[evals] could not work out what ${dataset.slug} owes ${provider.id}`, error);
    return { remoteId: null, remoteVersion: null, syncError: message, published: false };
  }

  if (row.remoteId && row.casesHash === hash && !row.syncError) {
    return {
      remoteId: row.remoteId,
      remoteVersion: row.remoteVersion,
      syncError: null,
      published: false,
    };
  }

  const leased = await takePublishLease(row.id);
  if (!leased) {
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
    await releasePublishLease(row.id);
  }
}

/**
 * Try to become the one publisher for this dataset.
 *
 * One conditional UPDATE, so two runs racing cannot both win it whichever
 * pooled connection each of them lands on. A Postgres advisory lock cannot do
 * this job here: it belongs to the connection that took it, and the release
 * would usually run on a different one and free nothing.
 * @param rowId - The publish row for this dataset and grader.
 */
async function takePublishLease(rowId: number): Promise<boolean> {
  const now = new Date();
  try {
    const claimed = await db
      .update(evalDatasetRemoteSchema)
      .set({ publishLeaseUntil: new Date(now.getTime() + PUBLISH_LEASE_MS) })
      .where(and(
        eq(evalDatasetRemoteSchema.id, rowId),
        or(
          isNull(evalDatasetRemoteSchema.publishLeaseUntil),
          lt(evalDatasetRemoteSchema.publishLeaseUntil, now),
        ),
      ))
      .returning({ id: evalDatasetRemoteSchema.id });
    return claimed.length > 0;
  } catch (error) {
    // A database that cannot take the lease must not stop evals running; the
    // worst case is the collision this was avoiding, which AWS itself refuses.
    console.error('[evals] could not take the publish lease', error);
    return true;
  }
}

/**
 * Let the next publisher in.
 * @param rowId - The publish row for this dataset and grader.
 */
async function releasePublishLease(rowId: number): Promise<void> {
  try {
    await db
      .update(evalDatasetRemoteSchema)
      .set({ publishLeaseUntil: null })
      .where(eq(evalDatasetRemoteSchema.id, rowId));
  } catch (error) {
    console.error('[evals] could not release the publish lease', error);
  }
}

/** Where a dataset's cases stand with the grader that holds them. */
export type DatasetSyncState = {
  /** The grader this state is about. */
  provider: string;
  /** The grader's own id for the dataset, once it has made one. */
  remoteId: string | null;
  /** The version the grader last cut. */
  remoteVersion: string | null;
  /** Whatever the grader last called the dataset's state. */
  status: string | null;
  /** Set when the last publish failed. */
  syncError: string | null;
  /** When we last tried. */
  syncedAt: Date | null;
  /** True when the cases here are not the ones the grader is holding. */
  drifted: boolean;
};

/**
 * Read the publish state for one dataset and grader, for the page to show.
 *
 * Drift is worked out here rather than stored, because it is a comparison
 * between two things that each change on their own: someone edits a case in
 * the workspace file long before the next run publishes it. A stored flag
 * would be stale the moment the file was applied.
 *
 * Returns null when this grader has never been asked to hold this dataset —
 * either because it keeps no dataset of its own, or because nothing has run
 * yet. The page tells those two apart from the provider, not from here.
 * @param orgId - Whose workspace.
 * @param datasetId - Which dataset.
 * @param providerId - Which grader.
 * @param items - The cases the dataset declares right now.
 * @param slug - The dataset's slug, which is part of the published content.
 */
export async function describeDatasetSync(
  orgId: string,
  datasetId: number,
  providerId: string,
  items: EvalDatasetItem[],
  slug: string,
): Promise<DatasetSyncState | null> {
  const [row] = await selectRemoteRow(orgId, datasetId, providerId);
  if (!row) {
    return null;
  }
  return {
    provider: row.provider,
    remoteId: row.remoteId,
    remoteVersion: row.remoteVersion,
    status: row.status,
    syncError: row.syncError,
    syncedAt: row.syncedAt,
    drifted: row.casesHash !== casesFingerprint(items, slug),
  };
}
