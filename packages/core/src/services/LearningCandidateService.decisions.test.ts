/**
 * What a decision on a candidate leaves behind, beyond the row itself: an
 * adoption event for BOTH outcomes (a rejection used to leave no trace at
 * all), the agent the rule is about, and the count of how many people asked
 * for it carried onto the adopted rule.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const trackMock = vi.fn();

vi.mock('@/services/adoption/track', () => ({ track: (...args: unknown[]) => trackMock(...args) }));
vi.mock('@/services/adoption/attribution', () => ({ agentSlugFromPrincipal: () => null }));

const { db } = await import('@/libs/DB');
const {
  learningCandidateSchema,
  learningFeedbackOccurrenceSchema,
  memoryNamespaceSchema,
  memorySchema,
} = await import('@/models/Schema');
const { decideCandidate } = await import('@/services/LearningCandidateService');

const ORG = 'org_decisions';
const STEP = 'crm-updates';
const REVIEWER = 'user_lead';

async function makeStep(): Promise<number> {
  const [row] = await db
    .insert(memoryNamespaceSchema)
    .values({ orgId: ORG, name: STEP, path: `workspace/${STEP}`, title: 'CRM updates', description: 'Rules for CRM update drafts.' })
    .returning({ id: memoryNamespaceSchema.id });
  return row!.id;
}

/**
 * A pending candidate, optionally with the occurrences behind it.
 * @param opts
 * @param opts.occurrenceCount
 * @param opts.agentSlug
 * @param opts.memoryType
 * @param opts.scopeKind
 * @param opts.scopeRef
 */
async function makeCandidate(opts: { occurrenceCount?: number; agentSlug?: string | null; memoryType?: string; scopeKind?: string; scopeRef?: string } = {}): Promise<number> {
  const [candidate] = await db
    .insert(learningCandidateSchema)
    .values({
      orgId: ORG,
      stepName: STEP,
      ruleText: 'always cite the source line for every number',
      polarity: 'correct',
      occurrenceCount: opts.occurrenceCount ?? 1,
      memoryType: opts.memoryType ?? null,
      scopeKind: opts.scopeKind ?? null,
      scopeRef: opts.scopeRef ?? null,
    })
    .returning({ id: learningCandidateSchema.id });

  await db.insert(learningFeedbackOccurrenceSchema).values({
    orgId: ORG,
    candidateId: candidate!.id,
    polarity: 'correct',
    note: 'you quoted a number with no source',
    agentSlug: opts.agentSlug ?? null,
    submittedBy: 'user_reviewer',
  });
  return candidate!.id;
}

beforeEach(async () => {
  await db.delete(learningFeedbackOccurrenceSchema);
  await db.delete(learningCandidateSchema);
  await db.delete(memorySchema);
  await db.delete(memoryNamespaceSchema);
  trackMock.mockReset();
});

describe('decideCandidate', () => {
  it('records the approval on the adoption stream, attributed to the agent', async () => {
    await makeStep();
    const candidateId = await makeCandidate({ agentSlug: 'pipeline-analyst' });

    const result = await decideCandidate({ orgId: ORG, id: candidateId, decision: 'approve', decidedBy: REVIEWER });

    expect(result.ok).toBe(true);
    expect(trackMock).toHaveBeenCalledWith(
      { orgId: ORG, userId: REVIEWER },
      'learning.candidate_decided',
      {
        agentSlug: 'pipeline-analyst',
        resource: ['learning_candidate', candidateId],
        meta: { decision: 'approved' },
      },
    );
  });

  it('records a rejection too, which used to leave no trace at all', async () => {
    await makeStep();
    const candidateId = await makeCandidate({ agentSlug: 'pipeline-analyst' });

    await decideCandidate({
      orgId: ORG,
      id: candidateId,
      decision: 'reject',
      reason: 'we do want the number without the source sometimes',
      decidedBy: REVIEWER,
    });

    expect(trackMock).toHaveBeenCalledWith(
      { orgId: ORG, userId: REVIEWER },
      'learning.candidate_decided',
      expect.objectContaining({ meta: { decision: 'rejected' } }),
    );
  });

  it('carries the occurrence count onto the adopted rule', async () => {
    await makeStep();
    const candidateId = await makeCandidate({ occurrenceCount: 4 });

    await decideCandidate({ orgId: ORG, id: candidateId, decision: 'approve', decidedBy: REVIEWER });

    const [rule] = await db.select().from(memorySchema);

    expect((rule?.value as { meta?: { occurrenceCount?: number } }).meta?.occurrenceCount).toBe(4);
  });

  it('leaves the agent unset when no occurrence named one', async () => {
    await makeStep();
    const candidateId = await makeCandidate({ agentSlug: null });

    await decideCandidate({ orgId: ORG, id: candidateId, decision: 'approve', decidedBy: REVIEWER });

    const decisionCall = trackMock.mock.calls.find(call => call[1] === 'learning.candidate_decided');

    expect(decisionCall?.[2]).toMatchObject({ agentSlug: undefined });
  });

  it('records no decision event when the candidate was already decided', async () => {
    await makeStep();
    const candidateId = await makeCandidate();
    await decideCandidate({ orgId: ORG, id: candidateId, decision: 'approve', decidedBy: REVIEWER });
    trackMock.mockReset();

    const result = await decideCandidate({ orgId: ORG, id: candidateId, decision: 'approve', decidedBy: REVIEWER });

    expect(result).toEqual({ ok: false, error: 'already_decided' });
    expect(trackMock).not.toHaveBeenCalled();
  });
});

describe('decideCandidate — typed, scoped adoption (Phase 2)', () => {
  it('lands a user-scoped preference in that user own namespace with its type', async () => {
    await makeStep();
    const candidateId = await makeCandidate({ memoryType: 'preference', scopeKind: 'user', scopeRef: 'user_jamie' });

    const result = await decideCandidate({ orgId: ORG, id: candidateId, decision: 'approve', decidedBy: REVIEWER });

    expect(result.ok).toBe(true);

    const [rule] = await db.select().from(memorySchema);

    expect(rule!.key.startsWith('/users/user_jamie/preferences/')).toBe(true);
    expect((rule!.value as { meta?: { type?: string } }).meta?.type).toBe('preference');

    const namespaces = await db.select().from(memoryNamespaceSchema);
    const created = namespaces.find(ns => ns.scopeKind === 'user');

    expect(created).toMatchObject({ scopeRef: 'user_jamie', path: 'users/user_jamie/preferences' });
  });

  it('still lands an unscoped candidate in its workspace step', async () => {
    await makeStep();
    const candidateId = await makeCandidate({ memoryType: 'procedure' });

    await decideCandidate({ orgId: ORG, id: candidateId, decision: 'approve', decidedBy: REVIEWER });

    const [rule] = await db.select().from(memorySchema);

    expect(rule!.key.startsWith(`/workspace/${STEP}/`)).toBe(true);
  });
});
