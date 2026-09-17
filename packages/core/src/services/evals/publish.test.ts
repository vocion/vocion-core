/**
 * Keeping the grader's copy of a dataset in step with ours.
 *
 * The rules worth pinning are the ones that cost money or truth: a nightly
 * schedule must not cut a new version in someone's AWS account for a dataset
 * nobody edited, a failed publish must not stop the eval being measured, and a
 * failure must never be recorded in a way that makes the next run think the
 * cases landed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { evalDatasetRemoteSchema, evalDatasetSchema } = await import('@/models/Schema');
const { eq } = await import('drizzle-orm');
const { describeDatasetSync, syncDatasetToProvider } = await import('./publish');

const ORG = 'org_publish_sync';

/**
 * A grader that keeps a dataset of its own.
 * @param publish - What its publish call should do.
 */
function publishingProvider(
  publish = vi.fn(async (_request: { remoteId: string | null }) => ({ remoteId: 'ds-1', remoteVersion: '1', status: 'ACTIVE' })),
) {
  return {
    provider: {
      id: 'agentcore',
      label: 'AgentCore',
      isAvailable: async () => ({ available: true, reason: '' }),
      score: async () => [],
      publishDataset: publish,
    },
    publish,
  };
}

/** A grader that holds the cases itself, like ours. */
const vocionLike = {
  id: 'vocion',
  label: 'Vocion',
  isAvailable: async () => ({ available: true, reason: '' }),
  score: async () => [],
};

async function seedDataset(items: Array<{ input: string; expectedOutput?: string }>) {
  const [row] = await db.insert(evalDatasetSchema).values({
    orgId: ORG,
    slug: 'refund-quality',
    name: 'Refund quality',
    agentSlug: 'support-agent',
    provider: 'agentcore',
    items,
  }).returning({ id: evalDatasetSchema.id });
  return {
    id: row!.id,
    slug: 'refund-quality',
    name: 'Refund quality',
    description: null,
    items,
  };
}

async function remoteRow(datasetId: number) {
  const [row] = await db
    .select()
    .from(evalDatasetRemoteSchema)
    .where(eq(evalDatasetRemoteSchema.datasetId, datasetId));
  return row ?? null;
}

beforeEach(async () => {
  await db.delete(evalDatasetRemoteSchema);
  await db.delete(evalDatasetSchema);
});

describe('syncDatasetToProvider', () => {
  it('does nothing for a grader that keeps no dataset of its own', async () => {
    const dataset = await seedDataset([{ input: 'one' }]);

    const result = await syncDatasetToProvider(ORG, dataset, vocionLike as never);

    // Our own judge reads the cases out of Postgres. Writing a remote row for
    // it would put a "synced" state on a page where nothing is ever synced.
    expect(result).toBeNull();
    expect(await remoteRow(dataset.id)).toBeNull();
  });

  it('publishes the first time and records what the grader called it', async () => {
    const dataset = await seedDataset([{ input: 'one' }]);
    const { provider, publish } = publishingProvider();

    const result = await syncDatasetToProvider(ORG, dataset, provider as never);

    expect(result).toMatchObject({ remoteId: 'ds-1', remoteVersion: '1', published: true, syncError: null });
    expect(publish).toHaveBeenCalledTimes(1);

    const row = await remoteRow(dataset.id);

    expect(row?.remoteId).toBe('ds-1');
    expect(row?.remoteVersion).toBe('1');
    expect(row?.casesHash).toBeTruthy();
    expect(row?.syncedAt).not.toBeNull();
  });

  it('sends nothing at all when the cases have not changed', async () => {
    const dataset = await seedDataset([{ input: 'one' }]);
    const { provider, publish } = publishingProvider();
    await syncDatasetToProvider(ORG, dataset, provider as never);
    const after = await remoteRow(dataset.id);

    const result = await syncDatasetToProvider(ORG, dataset, provider as never);

    // A nightly schedule must not cut a version a day in someone's AWS
    // account for a dataset nobody touched.
    expect(publish).toHaveBeenCalledTimes(1);
    expect(result?.published).toBe(false);

    const unchanged = await remoteRow(dataset.id);

    expect(unchanged?.casesHash).toBe(after?.casesHash);
    expect(unchanged?.syncedAt?.toISOString()).toBe(after?.syncedAt?.toISOString());
  });

  it('publishes again when a case changes, and says which dataset to update', async () => {
    const dataset = await seedDataset([{ input: 'one' }]);
    const { provider, publish } = publishingProvider();
    await syncDatasetToProvider(ORG, dataset, provider as never);

    const edited = { ...dataset, items: [{ input: 'one', expectedOutput: 'a refund is on the way' }] };
    await syncDatasetToProvider(ORG, edited, provider as never);

    expect(publish).toHaveBeenCalledTimes(2);
    // The second call carries the id from the first, so the grader updates the
    // dataset it already has rather than making a second one.
    expect(publish.mock.calls[1]![0]).toMatchObject({ remoteId: 'ds-1' });
  });

  it('records a failed publish and lets the run go ahead', async () => {
    const dataset = await seedDataset([{ input: 'one' }]);
    const failing = vi.fn(async () => {
      throw new Error('AWS refused the dataset');
    });
    const { provider } = publishingProvider(failing as never);

    const result = await syncDatasetToProvider(ORG, dataset, provider as never);

    // Scoring does not read the published copy, so refusing to measure would
    // cost more than an out-of-date mirror.
    expect(result?.syncError).toContain('AWS refused the dataset');
    expect(result?.published).toBe(false);

    const row = await remoteRow(dataset.id);

    expect(row?.syncError).toContain('AWS refused the dataset');
    // The hash stays empty: a publish that failed partway has to be resent in
    // full, not treated as landed.
    expect(row?.casesHash).toBeNull();
  });

  it('tries again after a failure, even though the cases are the same', async () => {
    const dataset = await seedDataset([{ input: 'one' }]);
    const flaky = vi.fn()
      .mockRejectedValueOnce(new Error('AWS timed out'))
      .mockResolvedValue({ remoteId: 'ds-1', remoteVersion: '1', status: 'ACTIVE' });
    const { provider } = publishingProvider(flaky as never);

    await syncDatasetToProvider(ORG, dataset, provider as never);
    const result = await syncDatasetToProvider(ORG, dataset, provider as never);

    // Without this, one bad night would leave the eval unsynced until somebody
    // edited a case.
    expect(flaky).toHaveBeenCalledTimes(2);
    expect(result?.syncError).toBeNull();

    const row = await remoteRow(dataset.id);

    expect(row?.syncError).toBeNull();
    expect(row?.casesHash).toBeTruthy();
  });

  it('keeps one row per grader, so switching graders and back loses nothing', async () => {
    const dataset = await seedDataset([{ input: 'one' }]);
    const { provider } = publishingProvider();
    await syncDatasetToProvider(ORG, dataset, provider as never);

    const other = publishingProvider(
      vi.fn(async (_request: { remoteId: string | null }) => ({ remoteId: 'az-9', remoteVersion: '4', status: 'READY' })),
    );
    await syncDatasetToProvider(ORG, dataset, { ...other.provider, id: 'azure-foundry' } as never);

    const rows = await db
      .select()
      .from(evalDatasetRemoteSchema)
      .where(eq(evalDatasetRemoteSchema.datasetId, dataset.id));

    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.provider).sort()).toEqual(['agentcore', 'azure-foundry']);
  });
});

describe('describeDatasetSync', () => {
  it('says nothing at all for a dataset nobody has tried to publish', async () => {
    const dataset = await seedDataset([{ input: 'one' }]);

    const state = await describeDatasetSync(dataset.id, 'agentcore', dataset.items, dataset.slug);

    // The page turns this into "not copied yet", which is true; inventing a
    // row here would make it read as a failed copy instead.
    expect(state).toBeNull();
  });

  it('calls the copy in step when the cases have not moved', async () => {
    const dataset = await seedDataset([{ input: 'one' }]);
    const { provider } = publishingProvider();
    await syncDatasetToProvider(ORG, dataset, provider as never);

    const state = await describeDatasetSync(dataset.id, 'agentcore', dataset.items, dataset.slug);

    expect(state?.drifted).toBe(false);
    expect(state?.remoteId).toBe('ds-1');
    expect(state?.remoteVersion).toBe('1');
  });

  it('spots cases edited since the last publish', async () => {
    const dataset = await seedDataset([{ input: 'one' }]);
    const { provider } = publishingProvider();
    await syncDatasetToProvider(ORG, dataset, provider as never);

    const edited = [{ input: 'one', expectedOutput: 'a refund is on the way' }];
    const state = await describeDatasetSync(dataset.id, 'agentcore', edited, dataset.slug);

    // Between someone editing the workspace file and the next run, the
    // version number AgentCore holds is measuring other cases.
    expect(state?.drifted).toBe(true);
  });

  it('keeps the failure visible for the page to show', async () => {
    const dataset = await seedDataset([{ input: 'one' }]);
    const failing = vi.fn(async () => {
      throw new Error('AWS refused the dataset');
    });
    const { provider } = publishingProvider(failing as never);
    await syncDatasetToProvider(ORG, dataset, provider as never);

    const state = await describeDatasetSync(dataset.id, 'agentcore', dataset.items, dataset.slug);

    expect(state?.syncError).toContain('AWS refused the dataset');
    expect(state?.remoteId).toBeNull();
  });
});
