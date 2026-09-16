/**
 * Searching and paging the eval dataset list.
 *
 * The list is the way into everything else, so the rules worth pinning are the
 * ones that would quietly hide a dataset: a search that only matches the name
 * when people remember the agent, a page that claims more behind it when there
 * is nothing, and a summary whose run count is however many rows happened to
 * be fetched rather than how many runs there are.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { evalDatasetSchema, evalRunSchema } = await import('@/models/Schema');
const { listDatasetsPage, summariseDatasetRuns } = await import('@/services/EvalService');

const ORG = 'org_dataset_paging';

async function seedDataset(slug: string, name: string, agentSlug: string): Promise<number> {
  const [row] = await db.insert(evalDatasetSchema).values({
    orgId: ORG,
    slug,
    name,
    agentSlug,
    items: [{ input: 'one' }],
  }).returning({ id: evalDatasetSchema.id });
  return row!.id;
}

beforeEach(async () => {
  await db.delete(evalRunSchema);
  await db.delete(evalDatasetSchema);
});

describe('listDatasetsPage', () => {
  it('finds a dataset by its agent, not just its name', async () => {
    await seedDataset('refund-quality', 'Refund quality', 'support-agent');
    await seedDataset('tone-check', 'Tone check', 'sales-assistant');

    const found = await listDatasetsPage(ORG, { q: 'SUPPORT' });

    // Case-insensitive, and matching the agent — "whatever the support agent
    // runs" is how people actually look for these.
    expect(found.datasets.map(dataset => dataset.slug)).toEqual(['refund-quality']);
  });

  it('pages without claiming a page that is not there', async () => {
    for (let i = 0; i < 5; i++) {
      await seedDataset(`set-${i}`, `Set ${i}`, 'support-agent');
    }

    const first = await listDatasetsPage(ORG, { pageSize: 3 });
    const second = await listDatasetsPage(ORG, { page: 2, pageSize: 3 });

    expect(first.datasets).toHaveLength(3);
    expect(first.hasMore).toBe(true);
    expect(second.datasets).toHaveLength(2);
    expect(second.hasMore).toBe(false);
  });

  it('keeps the search when paging, so page two is still the search', async () => {
    for (let i = 0; i < 4; i++) {
      await seedDataset(`refund-${i}`, `Refund ${i}`, 'support-agent');
    }
    await seedDataset('tone-check', 'Tone check', 'sales-assistant');

    const page2 = await listDatasetsPage(ORG, { q: 'refund', page: 2, pageSize: 3 });

    expect(page2.datasets.map(dataset => dataset.slug)).toEqual(['refund-3']);
    expect(page2.hasMore).toBe(false);
  });
});

describe('summariseDatasetRuns', () => {
  it('counts every run, names every grader, and takes the rate from the last finished one', async () => {
    const datasetId = await seedDataset('refund-quality', 'Refund quality', 'support-agent');
    const base = Date.parse('2026-09-01T00:00:00Z');
    await db.insert(evalRunSchema).values([
      { orgId: ORG, datasetId, agentSlug: 'support-agent', status: 'succeeded', provider: 'vocion', startedAt: new Date(base), metrics: { passRate: 0.5 } },
      { orgId: ORG, datasetId, agentSlug: 'support-agent', status: 'succeeded', provider: 'agentcore', startedAt: new Date(base + 1000), metrics: { passRate: 0.4 } },
      { orgId: ORG, datasetId, agentSlug: 'support-agent', status: 'succeeded', provider: 'vocion', startedAt: new Date(base + 2000), metrics: { passRate: 0.9 } },
      { orgId: ORG, datasetId, agentSlug: 'support-agent', status: 'running', provider: 'vocion', startedAt: new Date(base + 3000) },
    ]);

    const facts = (await summariseDatasetRuns(ORG, [datasetId])).get(datasetId);

    expect(facts?.runCount).toBe(4);
    expect(facts?.latestStatus).toBe('running');
    // The run in flight has no score, so the card still shows the 0.9 that the
    // last finished run actually measured.
    expect(facts?.lastPassRate).toBe(0.9);
    expect(facts?.providers).toEqual(['agentcore', 'vocion']);
  });

  it('says nothing about a dataset with no runs, rather than inventing a zero', async () => {
    const datasetId = await seedDataset('untouched', 'Untouched', 'support-agent');

    const facts = await summariseDatasetRuns(ORG, [datasetId]);

    expect(facts.has(datasetId)).toBe(false);
  });

  it('asks nothing when there are no datasets to ask about', async () => {
    const facts = await summariseDatasetRuns(ORG, []);

    expect(facts.size).toBe(0);
  });
});
