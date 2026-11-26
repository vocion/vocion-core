/**
 * `POST /api/v1/learning-candidates` — add a rule by hand over the API, for an
 * app with its own admin screen. The rule goes live and an approved candidate
 * is recorded with it, against the person the token acts for. PGlite; auth
 * stubbed at the door. `GET` on the same path is checked still to list.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));

const { db } = await import('@/libs/DB');
const { learningCandidateSchema, memoryNamespaceSchema, memorySchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { GET, POST } = await import('./route');

const ORG = 'org_add_learning';
const STEP = 'crm-updates';

function token(grants: string[] | null = null) {
  return {
    orgId: ORG,
    tokenId: 't1',
    principal: { kind: 'user' as const, id: 'token:t1', role: grants ? undefined : 'owner' as const, scope: { orgId: ORG }, grants: grants ?? ['*'] },
  };
}

function add(body: unknown) {
  return POST(new Request('https://vocion.test/api/v1/learning-candidates', {
    method: 'POST',
    headers: { 'authorization': 'Bearer vcn_live_fake_token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

async function rowCounts() {
  const rules = await db.select().from(memorySchema).where(eq(memorySchema.orgId, ORG));
  const candidates = await db.select().from(learningCandidateSchema).where(eq(learningCandidateSchema.orgId, ORG));
  return { rules: rules.length, candidates: candidates.length };
}

async function reset() {
  await db.delete(learningCandidateSchema).where(eq(learningCandidateSchema.orgId, ORG));
  await db.delete(memorySchema).where(eq(memorySchema.orgId, ORG));
  await db.delete(memoryNamespaceSchema).where(eq(memoryNamespaceSchema.orgId, ORG));
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(clerkAuth).mockResolvedValue({ userId: null, orgId: null, accountId: null, projectId: null, role: null, has: () => false } as never);
  vi.mocked(authenticateBearer).mockResolvedValue(token() as never);
  await reset();
  await db.insert(memoryNamespaceSchema).values({ orgId: ORG, name: STEP, path: `workspace/${STEP}`, title: 'CRM updates', description: 'Rules for CRM update drafts.' });
});

afterAll(reset);

describe('POST /api/v1/learning-candidates', () => {
  it('adds the rule, adopted, against the person the token acts for', async () => {
    const res = await add({ step: STEP, ruleText: 'Cite the invoice number.', decidedBy: 'larkfield-admin:7' });

    expect(res.status).toBe(201);

    const body = await res.json();

    expect(body).toMatchObject({ ok: true, candidate: { status: 'approved', stepName: STEP, decidedBy: 'larkfield-admin:7', polarity: 'correct', memoryType: null } });
    expect(body.ruleKey).toMatch(new RegExp(`/${STEP}/`));
    expect(body.candidate.createdMemoryKey).toBe(body.ruleKey);
  });

  it('records the token when no person is named, and echoes polarity and memory type', async () => {
    const res = await add({ step: STEP, ruleText: 'Keep the greeting short.', polarity: 'reinforce', memoryType: 'procedure' });

    expect(res.status).toBe(201);
    expect((await res.json()).candidate).toMatchObject({ decidedBy: 'token:t1', polarity: 'reinforce', memoryType: 'procedure' });
  });

  it('lists the added rule with the adopted ones, so GET still works beside POST', async () => {
    await add({ step: STEP, ruleText: 'Cite the invoice number.' });

    const res = await GET(new Request('https://vocion.test/api/v1/learning-candidates?status=approved', { headers: { authorization: 'Bearer vcn_live_fake_token' } }));

    expect(res.status).toBe(200);
    expect((await res.json()).items.map((c: { ruleText: string }) => c.ruleText)).toEqual(['Cite the invoice number.']);
  });

  it('refuses a near-duplicate with the rule it restates, and adds nothing', async () => {
    await add({ step: STEP, ruleText: 'Always cite the invoice number on every update.' });

    const res = await add({ step: STEP, ruleText: 'Always cite the invoice number on every update!' });

    expect(res.status).toBe(409);

    const { error } = await res.json();

    expect(error.code).toBe('CONFLICT');
    expect(error.details.existing.existingRule).toBe('Always cite the invoice number on every update.');
    expect(await rowCounts()).toEqual({ rules: 1, candidates: 1 });
  });

  it('refuses an unknown step, naming it so a client can tell it apart, and adds nothing', async () => {
    const res = await add({ step: 'no-such-step', ruleText: 'Cite the invoice number.' });

    expect(res.status).toBe(400);

    const { error } = await res.json();

    expect(error).toMatchObject({ code: 'VALIDATION_FAILED', message: 'Unknown learning step "no-such-step"', details: { step: 'no-such-step' } });
    expect(await rowCounts()).toEqual({ rules: 0, candidates: 0 });
  });

  it('refuses a body it cannot add, before writing anything', async () => {
    const cases: Array<[unknown, string]> = [
      [{ ruleText: 'Cite the invoice number.' }, 'step is required'],
      [{ step: '  ', ruleText: 'Cite the invoice number.' }, 'step is required'],
      [{ step: STEP }, 'ruleText must be 1–600 characters'],
      [{ step: STEP, ruleText: '   ' }, 'ruleText must be 1–600 characters'],
      [{ step: STEP, ruleText: 'x'.repeat(601) }, 'ruleText must be 1–600 characters'],
      [{ step: STEP, ruleText: 'Cite it.', polarity: 'sideways' }, 'polarity must be correct or reinforce'],
      [{ step: STEP, ruleText: 'Cite it.', memoryType: 'opinion' }, 'memoryType must be preference, knowledge or procedure'],
      [{ step: STEP, ruleText: 'Cite it.', decidedBy: '' }, 'decidedBy must be 1–200 characters'],
    ];
    for (const [body, message] of cases) {
      const res = await add(body);

      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).error.message).toBe(message);
    }

    expect(await rowCounts()).toEqual({ rules: 0, candidates: 0 });
  });

  it('accepts a rule of exactly 600 characters', async () => {
    expect((await add({ step: STEP, ruleText: 'x'.repeat(600) })).status).toBe(201);
  });

  it('refuses a token without the approve capability', async () => {
    vi.mocked(authenticateBearer).mockResolvedValue(token(['read']) as never);

    expect((await add({ step: STEP, ruleText: 'Cite the invoice number.' })).status).toBe(403);
    expect(await rowCounts()).toEqual({ rules: 0, candidates: 0 });
  });
});
