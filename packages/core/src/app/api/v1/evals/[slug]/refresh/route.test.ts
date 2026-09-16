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
const getProvider = vi.fn((id: string) => ({
  id,
  label: id,
  isAvailable: async () => ({ available: true }),
}) as { id: string; label: string; isAvailable: () => Promise<{ available: boolean; reason?: string }> } | undefined);
vi.mock('@/services/evals/providers/registry', () => ({
  listAvailableProviders: vi.fn(async () => [{ id: 'vocion', label: 'Vocion' }]),
  getProvider,
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

function post(slug: string, body?: unknown): Request {
  return new Request(`https://vocion.test/api/v1/evals/${slug}/refresh`, {
    method: 'POST',
    headers: { 'authorization': 'Bearer vcn_live_fake_token', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
    expect(body.provider).toBe('vocion');

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

  it('answers 400, not 500, when the dataset names a grader that does not exist', async () => {
    // A typo in the workspace file's `provider` is an authoring mistake. A 5xx
    // would page whoever watches the error rate for it.
    await db.update(evalDatasetSchema).set({ provider: 'azure' }).where(eq(evalDatasetSchema.orgId, ORG));
    getProvider.mockReturnValueOnce(undefined);

    const res = await POST(post('pw-refresh'), paramsFor('pw-refresh'));

    expect(res.status).toBe(400);

    const body = await res.json();

    expect(body.error.code).toBe('UNKNOWN_PROVIDER');
    expect(startWorkflow).not.toHaveBeenCalled();
  });

  it('answers 409 when the dataset\'s grader cannot run, and starts nothing', async () => {
    // AgentCore with no AWS credential connected. Retrying changes nothing
    // until someone fixes the credential, so it is not a 5xx and there is no
    // half-open run row left behind.
    await db.update(evalDatasetSchema).set({ provider: 'agentcore' }).where(eq(evalDatasetSchema.orgId, ORG));
    getProvider.mockReturnValueOnce({
      id: 'agentcore',
      label: 'AgentCore',
      isAvailable: async () => ({ available: false, reason: 'no AWS credential is connected' }),
    });

    const res = await POST(post('pw-refresh'), paramsFor('pw-refresh'));

    expect(res.status).toBe(409);

    const body = await res.json();

    expect(body.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(startWorkflow).not.toHaveBeenCalled();
    expect(await db.select().from(evalRunSchema)).toHaveLength(0);
  });

  it('answers 404 for another org\'s dataset, never 403', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(OTHER_ORG) as never);

    const res = await POST(post('pw-refresh'), paramsFor('pw-refresh'));

    expect(res.status).toBe(404);
    expect(startWorkflow).not.toHaveBeenCalled();
  });
});
