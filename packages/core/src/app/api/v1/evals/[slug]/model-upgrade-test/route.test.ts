/**
 * `POST /api/v1/evals/:slug/model-upgrade-test` — validation and tenancy.
 *
 * The two runs themselves are the service's business and are mocked; what
 * this route owns is refusing a half-specified body, refusing two identical
 * models (nothing to compare), and answering 404 for a dataset the caller's
 * org does not have — never 403, so a wrong-tenant token cannot tell "no
 * such dataset" from "not yours".
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/evals/modelUpgradeTest', () => ({ runModelUpgradeTest: vi.fn() }));

const { db } = await import('@/libs/DB');
const { evalDatasetSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { runModelUpgradeTest } = await import('@/services/evals/modelUpgradeTest');
const { POST } = await import('./route');

const mockBearer = vi.mocked(authenticateBearer);
const mockRun = vi.mocked(runModelUpgradeTest);

const ORG = 'org_mut_route';
const OTHER_ORG = 'org_mut_route_other';

function tokenPrincipal(orgId: string) {
  return {
    orgId,
    tokenId: 't1',
    principal: { kind: 'user' as const, id: 'token:t1', role: 'owner' as const, scope: { orgId }, grants: ['*'] },
  };
}

function post(slug: string, body: unknown): Request {
  return new Request(`https://vocion.test/api/v1/evals/${slug}/model-upgrade-test`, {
    method: 'POST',
    headers: { 'authorization': 'Bearer vcn_live_fake_token', 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const paramsFor = (slug: string) => ({ params: Promise.resolve({ slug }) });

beforeEach(async () => {
  mockBearer.mockReset();
  mockRun.mockReset();
  mockBearer.mockResolvedValue(tokenPrincipal(ORG) as never);
  await db.delete(evalDatasetSchema);
  await db.insert(evalDatasetSchema).values({
    orgId: ORG,
    slug: 'pw-upgrade',
    name: 'PW upgrade',
    agentSlug: 'proposal-writer',
    items: [{ input: 'x' }],
  });
});

afterAll(async () => {
  await db.delete(evalDatasetSchema);
});

describe('POST /api/v1/evals/:slug/model-upgrade-test', () => {
  it('runs the test and returns the run ids and comparison', async () => {
    mockRun.mockResolvedValue({ baselineRunId: 1, candidateRunId: 2, briefingId: 7, comparison: { verdict: 'ok' } as never });

    const res = await POST(post('pw-upgrade', { baselineModel: 'gpt-5.6-sol', candidateModel: 'gpt-6-astra' }), paramsFor('pw-upgrade'));

    expect(res.status).toBe(201);

    const body = await res.json();

    expect(body.baselineRunId).toBe(1);
    expect(body.candidateRunId).toBe(2);
    expect(body.briefingId).toBe(7);
    expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG,
      datasetSlug: 'pw-upgrade',
      baselineModel: 'gpt-5.6-sol',
      candidateModel: 'gpt-6-astra',
      publish: true,
    }));
  });

  it('refuses a body missing either model', async () => {
    const res = await POST(post('pw-upgrade', { baselineModel: 'gpt-5.6-sol' }), paramsFor('pw-upgrade'));

    expect(res.status).toBe(400);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('refuses two identical models — nothing to compare', async () => {
    const res = await POST(post('pw-upgrade', { baselineModel: 'gpt-6-astra', candidateModel: 'gpt-6-astra' }), paramsFor('pw-upgrade'));

    expect(res.status).toBe(400);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('refuses an unknown provider', async () => {
    const res = await POST(post('pw-upgrade', { baselineModel: 'a', candidateModel: 'b', candidateProvider: 'cohere' }), paramsFor('pw-upgrade'));

    expect(res.status).toBe(400);
  });

  it('404s a dataset the caller\'s org does not have', async () => {
    mockBearer.mockResolvedValue(tokenPrincipal(OTHER_ORG) as never);

    const res = await POST(post('pw-upgrade', { baselineModel: 'a', candidateModel: 'b' }), paramsFor('pw-upgrade'));

    expect(res.status).toBe(404);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('401s without a credential', async () => {
    mockBearer.mockResolvedValue(null as never);

    const res = await POST(post('pw-upgrade', { baselineModel: 'a', candidateModel: 'b' }), paramsFor('pw-upgrade'));

    expect(res.status).toBe(401);
  });

  it('turns a service failure into a 500 with the message', async () => {
    mockRun.mockRejectedValue(new Error('cannot tell which provider serves model "zz"'));

    const res = await POST(post('pw-upgrade', { baselineModel: 'gpt-5.6-sol', candidateModel: 'zz' }), paramsFor('pw-upgrade'));

    expect(res.status).toBe(500);

    const body = await res.json();

    expect(body.error.message).toMatch(/cannot tell which provider/);
  });
});
