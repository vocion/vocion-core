/**
 * `GET /api/v1/evals/:slug/runs` — a dataset's runs and numbers for a period.
 *
 * What this route owns: a bad period is a 400 and never an unfiltered list,
 * the period narrows both the runs and the summary, paging stays inside it,
 * and a token only ever sees its own org's runs.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { evalDatasetSchema, evalRunSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { EVAL_RUNS_PAGE_SIZE } = await import('@/services/EvalService');
const { GET } = await import('./route');

const mockBearer = vi.mocked(authenticateBearer);

const ORG = 'org_eval_runs_get';
const OTHER_ORG = 'org_eval_runs_get_other';
const SLUG = 'refund-quality';

function tokenPrincipal(orgId: string) {
  return {
    orgId,
    tokenId: 't1',
    principal: { kind: 'user' as const, id: 'token:t1', role: 'owner' as const, scope: { orgId }, grants: ['*'] },
  };
}

function get(query: string, slug = SLUG): Request {
  return new Request(`https://vocion.test/api/v1/evals/${slug}/runs${query}`, {
    headers: { authorization: 'Bearer vcn_live_fake_token' },
  });
}

const paramsFor = (slug: string) => ({ params: Promise.resolve({ slug }) });

async function createDataset(orgId: string): Promise<number> {
  const [dataset] = await db.insert(evalDatasetSchema).values({
    orgId,
    slug: SLUG,
    name: 'Refund quality',
    agentSlug: 'support-agent',
    items: [{ input: 'one' }],
  }).returning({ id: evalDatasetSchema.id });
  return dataset!.id;
}

async function createRun(orgId: string, datasetId: number, startedAt: string, passRate: number): Promise<void> {
  await db.insert(evalRunSchema).values({
    orgId,
    datasetId,
    agentSlug: 'support-agent',
    status: 'succeeded',
    startedAt: new Date(startedAt),
    metrics: { passRate },
  });
}

beforeEach(async () => {
  mockBearer.mockReset();
  mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);
  await db.delete(evalRunSchema);
  await db.delete(evalDatasetSchema);
});

afterAll(async () => {
  await db.delete(evalRunSchema);
  await db.delete(evalDatasetSchema);
});

describe('GET /api/v1/evals/:slug/runs', () => {
  it('returns only the runs in the period, with a summary of that period', async () => {
    const datasetId = await createDataset(ORG);
    await createRun(ORG, datasetId, '2026-09-02T12:00:00Z', 0.6);
    await createRun(ORG, datasetId, '2026-09-05T12:00:00Z', 1);
    await createRun(ORG, datasetId, '2026-08-15T12:00:00Z', 0);

    const res = await GET(get('?from=2026-09-01&to=2026-09-08'), paramsFor(SLUG));

    expect(res.status).toBe(200);

    const body = await res.json();

    expect(body.runs.map((run: { startedAt: string }) => run.startedAt)).toEqual(['2026-09-05T12:00:00.000Z', '2026-09-02T12:00:00.000Z']);
    expect(body.summary).toEqual({ runCount: 2, scoredCount: 2, averagePassRate: 0.8, latestPassRate: 1 });
    expect(body.period).toEqual({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-08T00:00:00.000Z' });
  });

  it('pages inside the period', async () => {
    const datasetId = await createDataset(ORG);
    for (let i = 0; i < EVAL_RUNS_PAGE_SIZE + 2; i++) {
      await createRun(ORG, datasetId, new Date(Date.parse('2026-09-01T00:00:00Z') + i * 60_000).toISOString(), 0.5);
    }

    const first = await (await GET(get('?from=2026-09-01'), paramsFor(SLUG))).json();
    const second = await (await GET(get('?from=2026-09-01&page=2'), paramsFor(SLUG))).json();

    expect(first.hasMore).toBe(true);
    expect(second.runs).toHaveLength(2);
    expect(second.hasMore).toBe(false);
    // The summary is the whole period, not the page.
    expect(second.summary.runCount).toBe(EVAL_RUNS_PAGE_SIZE + 2);
  });

  it.each([
    ['a date that is not one', '?from=last-week'],
    ['a range that runs backwards', '?from=2026-09-08&to=2026-09-01'],
    ['a range longer than a year', '?from=2024-09-01&to=2026-09-01'],
    ['a page that is not a number', '?page=2abc'],
    ['page zero', '?page=0'],
  ])('refuses %s with a 400 instead of listing every run', async (_, query) => {
    await createDataset(ORG);

    const res = await GET(get(query), paramsFor(SLUG));

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_FAILED');
  });

  it('never shows another org\'s runs for a dataset with the same slug', async () => {
    const otherDatasetId = await createDataset(OTHER_ORG);
    await createRun(OTHER_ORG, otherDatasetId, '2026-09-02T12:00:00Z', 0.9);

    const res = await GET(get('?from=2026-09-01'), paramsFor(SLUG));

    // This org has no dataset by that slug at all.
    expect(res.status).toBe(404);
  });

  it('refuses a caller with no valid token', async () => {
    mockBearer.mockResolvedValue(null as never);

    const res = await GET(get(''), paramsFor(SLUG));

    expect(res.status).toBe(401);
  });
});
