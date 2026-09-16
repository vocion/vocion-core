/**
 * `POST /api/v1/evals/:slug/refresh` — hand back a run before the work starts.
 *
 * Three rules this route owns, each of which has a real failure behind it:
 *
 * - It answers without executing the dataset. The route it replaces awaited
 *   the whole run, so pressing the button on a fifty-case dataset meant a
 *   browser holding a request open for minutes.
 * - The run row's group id is the workflow id. The workflow uses its own id as
 *   the run group, so if these two ever diverge a retried activity stops
 *   finding the row and files a second run for work that happened once.
 * - Temporal being down closes the row out. A run that nothing will ever fill
 *   in must not read as running forever.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const startWorkflow = vi.fn();
const getTemporalClient = vi.fn(async () => ({ workflow: { start: startWorkflow } }));

vi.mock('@/libs/temporal/client', async () => {
  const actual = await vi.importActual<typeof import('@/libs/temporal/client')>('@/libs/temporal/client');
  return { ...actual, getTemporalClient };
});

// Availability is a credential question that has nothing to do with this
// route; pinning it keeps the test from depending on whether the machine
// running it happens to have AWS credentials in its environment.
vi.mock('@/services/evals/providers/registry', () => ({
  listAvailableProviders: vi.fn(async () => [{ id: 'vocion', label: 'Vocion' }]),
  getProvider: vi.fn((id: string) => ({ id, label: id })),
}));

const { db } = await import('@/libs/DB');
const { evalDatasetSchema, evalRunSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { eq } = await import('drizzle-orm');
const { POST } = await import('./route');

const mockBearer = vi.mocked(authenticateBearer);

const ORG = 'org_eval_refresh';
const OTHER_ORG = 'org_eval_refresh_other';

function tokenPrincipal(orgId: string) {
  return {
    orgId,
    tokenId: 't1',
    principal: { kind: 'user' as const, id: 'token:t1', role: 'owner' as const, scope: { orgId }, grants: ['*'] },
  };
}

function post(slug: string): Request {
  return new Request(`https://vocion.test/api/v1/evals/${slug}/refresh`, {
    method: 'POST',
    headers: { authorization: 'Bearer vcn_live_fake_token' },
  });
}

const paramsFor = (slug: string) => ({ params: Promise.resolve({ slug }) });

beforeEach(async () => {
  startWorkflow.mockReset();
  startWorkflow.mockResolvedValue({ workflowId: 'started' });
  mockBearer.mockReset();
  mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);
  await db.delete(evalRunSchema);
  await db.delete(evalDatasetSchema);
  await db.insert(evalDatasetSchema).values({
    orgId: ORG,
    slug: 'pw-refresh',
    name: 'PW refresh',
    agentSlug: 'proposal-writer',
    items: [{ input: 'x' }],
  });
});

afterAll(async () => {
  await db.delete(evalRunSchema);
  await db.delete(evalDatasetSchema);
});

describe('POST /api/v1/evals/:slug/refresh', () => {
  it('returns a run that is still running, without executing the dataset', async () => {
    const res = await POST(post('pw-refresh'), paramsFor('pw-refresh'));

    expect(res.status).toBe(202);

    const body = await res.json();

    expect(body.status).toBe('running');
    expect(body.providers).toEqual(['vocion']);

    const [run] = await db.select().from(evalRunSchema).where(eq(evalRunSchema.id, body.runId));

    expect(run?.status).toBe('running');
    expect(run?.provider).toBe('vocion');
    expect(run?.completedAt).toBeNull();
  });

  it('gives the workflow the same id it wrote as the run group', async () => {
    const res = await POST(post('pw-refresh'), paramsFor('pw-refresh'));
    const body = await res.json();

    const [, options] = startWorkflow.mock.calls[0]!;

    expect(options.workflowId).toBe(body.runGroupId);

    const [run] = await db.select().from(evalRunSchema).where(eq(evalRunSchema.id, body.runId));

    expect(run?.runGroupId).toBe(options.workflowId);
  });

  it('passes the dataset and org the workflow needs to do the run', async () => {
    await POST(post('pw-refresh'), paramsFor('pw-refresh'));

    const [, options] = startWorkflow.mock.calls[0]!;

    expect(options.args[0]).toMatchObject({ orgId: ORG, datasetSlug: 'pw-refresh' });
  });

  it('marks the run failed when the workflow cannot be started', async () => {
    startWorkflow.mockRejectedValue(new Error('temporal unreachable'));

    const res = await POST(post('pw-refresh'), paramsFor('pw-refresh'));

    expect(res.status).toBe(503);

    const [run] = await db.select().from(evalRunSchema);

    expect(run?.status).toBe('failed');
    expect(run?.completedAt).not.toBeNull();
  });

  it('answers 404 for another org\'s dataset, never 403', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(OTHER_ORG) as never);

    const res = await POST(post('pw-refresh'), paramsFor('pw-refresh'));

    expect(res.status).toBe(404);
    expect(startWorkflow).not.toHaveBeenCalled();
  });
});
