/**
 * `POST /api/v1/learning-candidates/:id/unadopt` — take an adopted rule back
 * over the API. The rule leaves the store, so the agent stops reading it on its
 * next turn, and the candidate goes to `rejected` with the reason, so the
 * evidence stays and the same wording is not re-adopted unnoticed. The rule is
 * adopted for real through `decideCandidate` in each test; PGlite; auth stubbed
 * at the door.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));

const { db } = await import('@/libs/DB');
const { learningCandidateSchema, memoryNamespaceSchema, memorySchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { createCandidate, decideCandidate } = await import('@/services/LearningCandidateService');
const { removeRule } = await import('@/services/MemoryService');
const { POST } = await import('./route');

const ORG = 'org_unadopt';
const STEP = 'crm-updates';

/**
 * A tenant token. Owner tokens hold `approve` by role; a grants-only token
 * holds only what it was issued.
 * @param grants - Explicit grants, or null for an owner token.
 */
function token(grants: string[] | null = null) {
  return {
    orgId: ORG,
    tokenId: 't1',
    principal: { kind: 'user' as const, id: 'token:t1', role: grants ? undefined : 'owner' as const, scope: { orgId: ORG }, grants: grants ?? ['*'] },
  };
}

function unadopt(id: number | string, body: unknown = {}) {
  const req = new Request(`https://vocion.test/api/v1/learning-candidates/${id}/unadopt`, {
    method: 'POST',
    headers: { 'authorization': 'Bearer vcn_live_fake_token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id: String(id) }) });
}

/**
 * A rule adopted the way a person adopts one, returning the candidate and the
 * key of the rule it created.
 * @param scope - A scope to land the rule in, instead of the step.
 * @param scope.kind - The scope kind, e.g. `user`.
 * @param scope.ref - The scope's id.
 */
async function adopted(scope?: { kind: string; ref: string }): Promise<{ id: number; ruleKey: string }> {
  const candidate = await createCandidate({
    orgId: ORG,
    stepName: STEP,
    ruleText: `Cite the source line for every figure (${Math.random().toString(36).slice(2, 8)})`,
    scopeKind: scope?.kind ?? null,
    scopeRef: scope?.ref ?? null,
  });
  const decided = await decideCandidate({ orgId: ORG, id: candidate.id, decision: 'approve', decidedBy: 'u_reviewer' });
  if (!decided.ok || !decided.ruleKey) {
    throw new Error(`could not adopt the fixture rule: ${JSON.stringify(decided)}`);
  }
  return { id: candidate.id, ruleKey: decided.ruleKey };
}

async function ruleExists(key: string): Promise<boolean> {
  const rows = await db.select({ key: memorySchema.key }).from(memorySchema).where(and(eq(memorySchema.orgId, ORG), eq(memorySchema.key, key)));
  return rows.length > 0;
}

async function candidateRow(id: number) {
  const [row] = await db.select().from(learningCandidateSchema).where(eq(learningCandidateSchema.id, id));
  return row!;
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

describe('POST /api/v1/learning-candidates/:id/unadopt', () => {
  it('removes the rule and records the person a token acts for, with the reason', async () => {
    const { id, ruleKey } = await adopted();

    const res = await unadopt(id, { reason: '  Too broad  ', undoneBy: 'larkfield-admin:7' });

    expect(res.status).toBe(200);

    const body = await res.json();

    expect(body).toMatchObject({ ok: true, ruleKey, candidate: { id, status: 'rejected', rejectedReason: 'Too broad', decidedBy: 'larkfield-admin:7', createdMemoryKey: null } });
    expect(await ruleExists(ruleKey)).toBe(false);
  });

  it('records the token and a default reason when the caller names neither', async () => {
    const { id } = await adopted();

    const res = await unadopt(id);

    expect(res.status).toBe(200);
    expect(await candidateRow(id)).toMatchObject({ status: 'rejected', rejectedReason: 'Retired over the API.', decidedBy: 'token:t1' });
  });

  it('still flips the candidate when someone already removed the rule by hand', async () => {
    const { id, ruleKey } = await adopted();
    await removeRule({ orgId: ORG, key: ruleKey });

    const res = await unadopt(id, { reason: 'Already gone' });

    expect(res.status).toBe(200);
    expect(await candidateRow(id)).toMatchObject({ status: 'rejected', rejectedReason: 'Already gone' });
  });

  it('removes a scoped rule from its own namespace, which a delete by step would miss', async () => {
    const { id, ruleKey } = await adopted({ kind: 'user', ref: 'u_kestrel_7' });

    expect(ruleKey).not.toContain(`/${STEP}/`);

    const res = await unadopt(id);

    expect(res.status).toBe(200);
    expect(await ruleExists(ruleKey)).toBe(false);
  });

  it('answers 404 for a candidate that does not exist, or is another workspace\'s', async () => {
    const { id } = await adopted();
    vi.mocked(authenticateBearer).mockResolvedValue({ ...token(), orgId: 'org_other', principal: { ...token().principal, scope: { orgId: 'org_other' } } } as never);

    expect((await unadopt(id)).status).toBe(404);
    expect((await unadopt(999_999)).status).toBe(404);
    expect((await candidateRow(id)).status).toBe('approved');
  });

  it('refuses a candidate that is not adopted, and changes nothing', async () => {
    const pending = await createCandidate({ orgId: ORG, stepName: STEP, ruleText: 'Never round a figure the source gives exactly' });
    const { id: rejectedId } = await adopted();
    await unadopt(rejectedId);

    for (const id of [pending.id, rejectedId]) {
      const res = await unadopt(id);

      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe('CONFLICT');
    }

    expect((await candidateRow(pending.id)).status).toBe('pending');
  });

  it('refuses a token without the approve capability and leaves the rule in place', async () => {
    const { id, ruleKey } = await adopted();
    vi.mocked(authenticateBearer).mockResolvedValue(token(['read']) as never);

    const res = await unadopt(id);

    expect(res.status).toBe(403);
    expect(await ruleExists(ruleKey)).toBe(true);
  });

  it('refuses a malformed id or an over-long reason before touching anything', async () => {
    const { id, ruleKey } = await adopted();

    expect((await unadopt('12abc')).status).toBe(400);

    const res = await unadopt(id, { reason: 'x'.repeat(501) });

    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe('reason must be at most 500 characters');
    expect(await ruleExists(ruleKey)).toBe(true);
  });
});
