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
  learningSchema,
  learningStepSchema,
} = await import('@/models/Schema');
const { decideCandidate } = await import('@/services/LearningCandidateService');

const ORG = 'org_decisions';
const STEP = 'crm-updates';
const REVIEWER = 'user_lead';

async function makeStep(): Promise<number> {
  const [row] = await db
    .insert(learningStepSchema)
    .values({ orgId: ORG, name: STEP, title: 'CRM updates', description: 'Rules for CRM update drafts.' })
    .returning({ id: learningStepSchema.id });
  return row!.id;
}

/**
 * A pending candidate, optionally with the occurrences behind it.
 * @param opts
 * @param opts.occurrenceCount
 * @param opts.agentSlug
 */
async function makeCandidate(opts: { occurrenceCount?: number; agentSlug?: string | null } = {}): Promise<number> {
  const [candidate] = await db
    .insert(learningCandidateSchema)
    .values({
      orgId: ORG,
      stepName: STEP,
      ruleText: 'always cite the source line for every number',
      polarity: 'correct',
      occurrenceCount: opts.occurrenceCount ?? 1,
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
  await db.delete(learningSchema);
  await db.delete(learningStepSchema);
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

    const [rule] = await db.select().from(learningSchema);

    expect(rule?.occurrenceCount).toBe(4);
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
