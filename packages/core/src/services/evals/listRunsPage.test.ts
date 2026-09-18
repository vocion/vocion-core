/**
 * Paging a dataset's run list.
 *
 * A dataset on a nightly schedule passes the old fifty-row cap in under two
 * months, and the bug that hides is silent: the list still looks complete,
 * it just stops being able to reach anything older. So the rules here are
 * about the boundaries — that a page holds what it says, that "is there more"
 * is right on the exact page where the runs end, and that a grader filter
 * pages within that grader rather than across everyone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { evalDatasetSchema, evalRunSchema } = await import('@/models/Schema');
const { listRunsPage } = await import('@/services/EvalService');

const ORG = 'org_runs_paging';

async function seedRuns(count: number): Promise<number> {
  const [dataset] = await db.insert(evalDatasetSchema).values({
    orgId: ORG,
    slug: 'refund-quality',
    name: 'Refund quality',
    agentSlug: 'support-agent',
    items: [{ input: 'one' }],
  }).returning({ id: evalDatasetSchema.id });

  const start = Date.parse('2026-01-01T00:00:00Z');
  for (let i = 0; i < count; i++) {
    await db.insert(evalRunSchema).values({
      orgId: ORG,
      datasetId: dataset!.id,
      agentSlug: 'support-agent',
      status: 'succeeded',
      // One a day, so "newest first" has an unambiguous order.
      startedAt: new Date(start + i * 86_400_000),
      provider: i % 2 === 0 ? 'vocion' : 'agentcore',
      metrics: { passRate: 0.5 },
    });
  }
  return dataset!.id;
}

beforeEach(async () => {
  await db.delete(evalRunSchema);
  await db.delete(evalDatasetSchema);
});

describe('listRunsPage', () => {
  it('hands back a full page and says there is more behind it', async () => {
    const datasetId = await seedRuns(25);

    const first = await listRunsPage(ORG, datasetId, { pageSize: 10 });

    expect(first.runs).toHaveLength(10);
    expect(first.hasMore).toBe(true);
    // Newest first, so the last run seeded leads.
    expect(first.runs[0]!.startedAt.toISOString()).toBe(new Date(Date.parse('2026-01-25T00:00:00Z')).toISOString());
  });

  it('says there is nothing more on the page where the runs actually end', async () => {
    const datasetId = await seedRuns(25);

    const last = await listRunsPage(ORG, datasetId, { page: 3, pageSize: 10 });

    // Five left over, and no phantom fourth page for someone to click into.
    expect(last.runs).toHaveLength(5);
    expect(last.hasMore).toBe(false);
  });

  it('pages within one grader, not across all of them', async () => {
    const datasetId = await seedRuns(25);

    const page = await listRunsPage(ORG, datasetId, { page: 2, pageSize: 5, provider: 'agentcore' });

    // Twelve agentcore runs in total: a second page of five, with two behind.
    expect(page.runs.every(run => run.provider === 'agentcore')).toBe(true);
    expect(page.runs).toHaveLength(5);
    expect(page.hasMore).toBe(true);
  });

  it('treats a nonsense page number as the first page', async () => {
    const datasetId = await seedRuns(3);

    const page = await listRunsPage(ORG, datasetId, { page: 0, pageSize: 10 });

    // A hand-edited URL must not produce a negative offset, which Postgres
    // refuses outright — the page should just show the newest runs.
    expect(page.page).toBe(1);
    expect(page.runs).toHaveLength(3);
  });
});
