/**
 * Learning-candidate lifecycle against PGlite: create → edit → approve into a
 * real rule, or reject with a reason. Covers the guards too — a decided
 * candidate is immutable, a rejection needs a reason, and approving a
 * near-duplicate is refused rather than doubling up the rule.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// `addLearning` fires an adoption event without awaiting it. Left real, that
// floating import resolves after the test file has torn down and surfaces as an
// unhandled rejection, so stub both modules it reaches for.
vi.mock('@/services/adoption/track', () => ({ track: vi.fn() }));
vi.mock('@/services/adoption/attribution', () => ({ agentSlugFromPrincipal: vi.fn(() => undefined) }));

const { db } = await import('@/libs/DB');
const { learningCandidateSchema, learningSchema, learningStepSchema } = await import('@/models/Schema');
const {
  createCandidate,
  decideCandidate,
  effectiveRuleText,
  getCandidate,
  isCandidateStatus,
  listCandidates,
  updateCandidate,
} = await import('@/services/LearningCandidateService');

const ORG = 'org_candidates';
const OTHER_ORG = 'org_someone_else';
const STEP = 'crm-updates';

async function makeStep(orgId = ORG): Promise<number> {
  const [row] = await db
    .insert(learningStepSchema)
    .values({ orgId, name: STEP, title: 'CRM updates', description: 'Rules for CRM update drafts.' })
    .returning({ id: learningStepSchema.id });
  return row!.id;
}

beforeEach(async () => {
  await db.delete(learningCandidateSchema);
  await db.delete(learningSchema);
  await db.delete(learningStepSchema);
});

afterAll(async () => {
  await db.delete(learningCandidateSchema);
  await db.delete(learningSchema);
  await db.delete(learningStepSchema);
});

describe('helpers', () => {
  it('recognises only the three real statuses', () => {
    expect(isCandidateStatus('pending')).toBe(true);
    expect(isCandidateStatus('approved')).toBe(true);
    expect(isCandidateStatus('rejected')).toBe(true);
    expect(isCandidateStatus('maybe')).toBe(false);
    expect(isCandidateStatus(7)).toBe(false);
  });

  it('prefers a human edit over the classifier text', () => {
    expect(effectiveRuleText({ ruleText: 'original', editedRuleText: 'edited' })).toBe('edited');
    expect(effectiveRuleText({ ruleText: 'original', editedRuleText: null })).toBe('original');
    expect(effectiveRuleText({ ruleText: 'original', editedRuleText: '   ' })).toBe('original');
  });
});

describe('createCandidate', () => {
  it('lands a proposal as pending', async () => {
    const candidate = await createCandidate({ orgId: ORG, stepName: STEP, ruleText: '  Always cite the source line.  ' });

    expect(candidate.status).toBe('pending');
    expect(candidate.ruleText).toBe('Always cite the source line.');
    expect(candidate.decidedAt).toBeNull();
  });

  it('refuses empty rule text', async () => {
    await expect(createCandidate({ orgId: ORG, stepName: STEP, ruleText: '   ' })).rejects.toThrow('rule text must not be empty');
  });
});

describe('listCandidates', () => {
  it('filters by status and step, and reports a real total', async () => {
    await createCandidate({ orgId: ORG, stepName: STEP, ruleText: 'Rule one.' });
    await createCandidate({ orgId: ORG, stepName: STEP, ruleText: 'Rule two.' });
    await createCandidate({ orgId: ORG, stepName: 'other-step', ruleText: 'Rule three.' });
    await createCandidate({ orgId: OTHER_ORG, stepName: STEP, ruleText: 'Not yours.' });

    const pending = await listCandidates(ORG, { status: 'pending' });

    expect(pending.total).toBe(3);
    expect(pending.items).toHaveLength(3);

    const forStep = await listCandidates(ORG, { stepName: STEP });

    expect(forStep.total).toBe(2);
  });

  it('pages without changing the total', async () => {
    await createCandidate({ orgId: ORG, stepName: STEP, ruleText: 'Rule one.' });
    await createCandidate({ orgId: ORG, stepName: STEP, ruleText: 'Rule two.' });
    await createCandidate({ orgId: ORG, stepName: STEP, ruleText: 'Rule three.' });

    const page = await listCandidates(ORG, { limit: 2, offset: 0 });

    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);

    const second = await listCandidates(ORG, { limit: 2, offset: 2 });

    expect(second.items).toHaveLength(1);
    expect(second.total).toBe(3);
  });

  it('never returns another org rows', async () => {
    await createCandidate({ orgId: OTHER_ORG, stepName: STEP, ruleText: 'Not yours.' });

    expect((await listCandidates(ORG)).items).toHaveLength(0);
  });
});

describe('getCandidate', () => {
  it('is null for an id another org owns', async () => {
    const mine = await createCandidate({ orgId: OTHER_ORG, stepName: STEP, ruleText: 'Not yours.' });

    expect(await getCandidate(ORG, mine.id)).toBeNull();
    expect(await getCandidate(OTHER_ORG, mine.id)).not.toBeNull();
  });
});

describe('updateCandidate', () => {
  it('stores the edit and leaves the original text alone', async () => {
    const candidate = await createCandidate({ orgId: ORG, stepName: STEP, ruleText: 'Original text.' });

    const result = await updateCandidate({ orgId: ORG, id: candidate.id, editedRuleText: 'Reworded text.' });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.candidate.editedRuleText).toBe('Reworded text.');
      expect(result.candidate.ruleText).toBe('Original text.');
    }
  });

  it('retargets a candidate at a different step', async () => {
    const candidate = await createCandidate({ orgId: ORG, stepName: STEP, ruleText: 'Original text.' });

    const result = await updateCandidate({ orgId: ORG, id: candidate.id, stepName: 'somewhere-else' });

    expect(result.ok && result.candidate.stepName).toBe('somewhere-else');
  });

  it('refuses empty edited text', async () => {
    const candidate = await createCandidate({ orgId: ORG, stepName: STEP, ruleText: 'Original text.' });

    expect(await updateCandidate({ orgId: ORG, id: candidate.id, editedRuleText: '  ' }))
      .toEqual({ ok: false, error: 'empty_rule_text' });
  });

  it('is a no-op that still succeeds when nothing was passed', async () => {
    const candidate = await createCandidate({ orgId: ORG, stepName: STEP, ruleText: 'Original text.' });

    const result = await updateCandidate({ orgId: ORG, id: candidate.id });

    expect(result.ok && result.candidate.id).toBe(candidate.id);
  });

  it('is not found for another org', async () => {
    const candidate = await createCandidate({ orgId: OTHER_ORG, stepName: STEP, ruleText: 'Not yours.' });

    expect(await updateCandidate({ orgId: ORG, id: candidate.id, editedRuleText: 'x' }))
      .toEqual({ ok: false, error: 'not_found' });
  });

  it('will not edit a candidate that has already been decided', async () => {
    await makeStep();
    const candidate = await createCandidate({ orgId: ORG, stepName: STEP, ruleText: 'Original text.' });
    await decideCandidate({ orgId: ORG, id: candidate.id, decision: 'reject', reason: 'not a rule', decidedBy: 'u_drew' });

    expect(await updateCandidate({ orgId: ORG, id: candidate.id, editedRuleText: 'x' }))
      .toEqual({ ok: false, error: 'already_decided' });
  });
});

describe('decideCandidate — approve', () => {
  it('creates the learning rule and links it back', async () => {
    await makeStep();
    const candidate = await createCandidate({ orgId: ORG, stepName: STEP, ruleText: 'Always cite the source line.' });

    const result = await decideCandidate({ orgId: ORG, id: candidate.id, decision: 'approve', decidedBy: 'u_drew' });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.candidate.status).toBe('approved');
    expect(result.candidate.decidedBy).toBe('u_drew');
    expect(result.candidate.decidedAt).toBeInstanceOf(Date);
    expect(result.ruleId).toBe(result.candidate.createdLearningId);

    const rules = await db.select().from(learningSchema);

    expect(rules).toHaveLength(1);
    expect(rules[0]!.ruleText).toBe('Always cite the source line.');
  });

  it('adopts the edited text, not the original', async () => {
    await makeStep();
    const candidate = await createCandidate({ orgId: ORG, stepName: STEP, ruleText: 'Original wording of the rule.' });
    await updateCandidate({ orgId: ORG, id: candidate.id, editedRuleText: 'Completely different guidance entirely.' });

    await decideCandidate({ orgId: ORG, id: candidate.id, decision: 'approve', decidedBy: 'u_drew' });

    const rules = await db.select().from(learningSchema);

    expect(rules[0]!.ruleText).toBe('Completely different guidance entirely.');
  });

  it('refuses a near-duplicate of a rule already on file', async () => {
    await makeStep();
    const first = await createCandidate({ orgId: ORG, stepName: STEP, ruleText: 'Always cite the source line.' });
    await decideCandidate({ orgId: ORG, id: first.id, decision: 'approve', decidedBy: 'u_drew' });

    const second = await createCandidate({ orgId: ORG, stepName: STEP, ruleText: 'Always cite the source line.' });
    const result = await decideCandidate({ orgId: ORG, id: second.id, decision: 'approve', decidedBy: 'u_drew' });

    expect(result).toMatchObject({ ok: false, error: 'near_duplicate' });
    expect(await db.select().from(learningSchema)).toHaveLength(1);
    expect((await getCandidate(ORG, second.id))!.status).toBe('pending');
  });

  it('reports an unknown step rather than throwing', async () => {
    const candidate = await createCandidate({ orgId: ORG, stepName: 'no-such-step', ruleText: 'Some rule.' });

    expect(await decideCandidate({ orgId: ORG, id: candidate.id, decision: 'approve', decidedBy: 'u_drew' }))
      .toEqual({ ok: false, error: 'unknown_step' });
  });
});

describe('decideCandidate — reject', () => {
  it('records the reason and writes no rule', async () => {
    await makeStep();
    const candidate = await createCandidate({ orgId: ORG, stepName: STEP, ruleText: 'Some rule.' });

    const result = await decideCandidate({
      orgId: ORG,
      id: candidate.id,
      decision: 'reject',
      reason: 'This is an edit, not a standing rule.',
      decidedBy: 'u_drew',
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.candidate.status).toBe('rejected');
    expect(result.candidate.rejectedReason).toBe('This is an edit, not a standing rule.');
    expect(result.ruleId).toBeNull();
    expect(await db.select().from(learningSchema)).toHaveLength(0);
  });

  it('requires a reason', async () => {
    const candidate = await createCandidate({ orgId: ORG, stepName: STEP, ruleText: 'Some rule.' });

    expect(await decideCandidate({ orgId: ORG, id: candidate.id, decision: 'reject', decidedBy: 'u_drew' }))
      .toEqual({ ok: false, error: 'reason_required' });
    expect(await decideCandidate({ orgId: ORG, id: candidate.id, decision: 'reject', reason: '   ', decidedBy: 'u_drew' }))
      .toEqual({ ok: false, error: 'reason_required' });
    expect((await getCandidate(ORG, candidate.id))!.status).toBe('pending');
  });
});

describe('decideCandidate — guards', () => {
  it('is not found for another org', async () => {
    const candidate = await createCandidate({ orgId: OTHER_ORG, stepName: STEP, ruleText: 'Not yours.' });

    expect(await decideCandidate({ orgId: ORG, id: candidate.id, decision: 'approve', decidedBy: 'u_drew' }))
      .toEqual({ ok: false, error: 'not_found' });
  });

  it('will not decide the same candidate twice', async () => {
    await makeStep();
    const candidate = await createCandidate({ orgId: ORG, stepName: STEP, ruleText: 'Some rule.' });
    await decideCandidate({ orgId: ORG, id: candidate.id, decision: 'reject', reason: 'no', decidedBy: 'u_drew' });

    expect(await decideCandidate({ orgId: ORG, id: candidate.id, decision: 'approve', decidedBy: 'u_drew' }))
      .toEqual({ ok: false, error: 'already_decided' });
  });
});
