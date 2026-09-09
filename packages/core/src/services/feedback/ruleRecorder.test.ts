/**
 * What happens to a proposed rule, against PGlite with the duplicate judge
 * stubbed: a new idea becomes a pending candidate with one occurrence, a
 * restatement bumps a count instead of writing a second row, and feedback with
 * nowhere to attach is reported rather than silently dropped.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const invokeMock = vi.fn();

vi.mock('@/libs/llm', () => ({
  buildChatModel: () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }),
}));

vi.mock('@/libs/Langfuse', () => ({
  cleanUsageDetails: (details: unknown) => details,
  traceFor: () => ({
    update: () => {},
    generation: () => ({ end: () => {} }),
  }),
}));

const trackMock = vi.fn();

vi.mock('@/services/adoption/track', () => ({ track: (...args: unknown[]) => trackMock(...args) }));

const { db } = await import('@/libs/DB');
const {
  learningCandidateSchema,
  learningFeedbackOccurrenceSchema,
  learningSchema,
  learningStepSchema,
} = await import('@/models/Schema');
const { recordProposedRule } = await import('@/services/feedback/ruleRecorder');
const { eq } = await import('drizzle-orm');

const ORG = 'org_recorder';
const STEP = 'crm-updates';
const RULE = 'always cite the source line for every number';

/**
 * The judge's answer for the next call: the LINE of the shortlisted rule it
 * matched, or none. Lines are 1-based in the order the recorder loads rules —
 * pending candidates newest-first, then adopted rules.
 * @param matchedLine
 */
function judgeAnswers(matchedLine: number | null) {
  invokeMock.mockResolvedValue({ content: JSON.stringify({ duplicate_of: matchedLine, reason: 'test' }) });
}

async function makeStep(name = STEP): Promise<number> {
  const [row] = await db
    .insert(learningStepSchema)
    .values({ orgId: ORG, name, title: 'CRM updates', description: 'Rules for CRM update drafts.' })
    .returning({ id: learningStepSchema.id });
  return row!.id;
}

beforeEach(async () => {
  await db.delete(learningFeedbackOccurrenceSchema);
  await db.delete(learningCandidateSchema);
  await db.delete(learningSchema);
  await db.delete(learningStepSchema);
  invokeMock.mockReset();
  trackMock.mockReset();
});

describe('recordProposedRule', () => {
  it('creates a pending candidate with one occurrence when the rule is new', async () => {
    await makeStep();
    judgeAnswers(null);

    const result = await recordProposedRule({
      orgId: ORG,
      ruleText: RULE,
      polarity: 'correct',
      stepName: STEP,
      note: 'you quoted a number with no source again',
      agentSlug: 'pipeline-analyst',
      sourceRunId: 42,
      submittedBy: 'user_1',
    });

    expect(result).toMatchObject({ outcome: 'created' });

    const [candidate] = await db.select().from(learningCandidateSchema);

    expect(candidate).toMatchObject({
      status: 'pending',
      polarity: 'correct',
      occurrenceCount: 1,
      stepName: STEP,
      sourceRunId: 42,
    });

    const occurrences = await db.select().from(learningFeedbackOccurrenceSchema);

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({
      candidateId: candidate!.id,
      learningId: null,
      polarity: 'correct',
      note: 'you quoted a number with no source again',
      agentSlug: 'pipeline-analyst',
      submittedBy: 'user_1',
    });
  });

  it('keeps positive feedback as a reinforcement candidate', async () => {
    await makeStep();
    judgeAnswers(null);

    await recordProposedRule({
      orgId: ORG,
      ruleText: 'keep leading with the weighted total',
      polarity: 'reinforce',
      stepName: STEP,
      note: 'leading with the number was exactly right',
      submittedBy: 'user_1',
    });

    const [candidate] = await db.select().from(learningCandidateSchema);

    expect(candidate?.polarity).toBe('reinforce');
  });

  it('bumps the count instead of creating a second candidate for a restatement', async () => {
    await makeStep();
    judgeAnswers(null);
    await recordProposedRule({
      orgId: ORG,
      ruleText: RULE,
      polarity: 'correct',
      stepName: STEP,
      note: 'first person asked',
      submittedBy: 'user_1',
    });

    judgeAnswers(1);
    const second = await recordProposedRule({
      orgId: ORG,
      ruleText: 'never state a number without pointing at where it came from',
      polarity: 'correct',
      stepName: STEP,
      note: 'second person asked',
      submittedBy: 'user_2',
    });

    expect(second).toMatchObject({ outcome: 'duplicate' });

    const candidates = await db.select().from(learningCandidateSchema);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.occurrenceCount).toBe(2);

    const occurrences = await db.select().from(learningFeedbackOccurrenceSchema);

    expect(occurrences).toHaveLength(2);
    expect(occurrences.map(row => row.note)).toEqual(['first person asked', 'second person asked']);
  });

  it('bumps an already-adopted rule and creates no candidate', async () => {
    const stepId = await makeStep();
    const [rule] = await db
      .insert(learningSchema)
      .values({ orgId: ORG, stepId, ruleText: RULE })
      .returning({ id: learningSchema.id });
    judgeAnswers(1);

    const result = await recordProposedRule({
      orgId: ORG,
      ruleText: 'never state a number without pointing at where it came from',
      polarity: 'correct',
      stepName: STEP,
      note: 'asked again after adoption',
      submittedBy: 'user_3',
    });

    expect(result).toMatchObject({ outcome: 'duplicate', matched: { kind: 'learning', id: rule!.id } });
    expect(await db.select().from(learningCandidateSchema)).toHaveLength(0);

    const [adopted] = await db.select().from(learningSchema).where(eq(learningSchema.id, rule!.id));

    expect(adopted?.occurrenceCount).toBe(2);

    const [occurrence] = await db.select().from(learningFeedbackOccurrenceSchema);

    expect(occurrence).toMatchObject({ learningId: rule!.id, candidateId: null });
  });

  it('falls back to the org\'s first learning step when the caller names none', async () => {
    await makeStep('first-step');
    await makeStep('second-step');
    judgeAnswers(null);

    await recordProposedRule({ orgId: ORG, ruleText: RULE, polarity: 'correct' });

    const [candidate] = await db.select().from(learningCandidateSchema);

    expect(candidate?.stepName).toBe('first-step');
  });

  it('reports that there is nowhere to attach when the org has no steps', async () => {
    const result = await recordProposedRule({ orgId: ORG, ruleText: RULE, polarity: 'correct' });

    expect(result).toEqual({ outcome: 'skipped', reason: 'no_learning_step' });
    expect(await db.select().from(learningCandidateSchema)).toHaveLength(0);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('reports empty rule text without touching the database', async () => {
    await makeStep();

    const result = await recordProposedRule({ orgId: ORG, ruleText: '   ', polarity: 'correct' });

    expect(result).toEqual({ outcome: 'skipped', reason: 'empty_rule_text' });
    expect(await db.select().from(learningCandidateSchema)).toHaveLength(0);
  });

  it('puts both outcomes on the adoption stream', async () => {
    await makeStep();
    judgeAnswers(null);
    await recordProposedRule({
      orgId: ORG,
      ruleText: RULE,
      polarity: 'correct',
      stepName: STEP,
      agentSlug: 'pipeline-analyst',
      submittedBy: 'user_1',
    });

    expect(trackMock).toHaveBeenLastCalledWith(
      { orgId: ORG, userId: 'user_1' },
      'learning.candidate_created',
      { agentSlug: 'pipeline-analyst', meta: { polarity: 'correct' } },
    );

    judgeAnswers(1);
    await recordProposedRule({
      orgId: ORG,
      ruleText: RULE,
      polarity: 'correct',
      stepName: STEP,
      agentSlug: 'pipeline-analyst',
      submittedBy: 'user_2',
    });

    expect(trackMock).toHaveBeenLastCalledWith(
      { orgId: ORG, userId: 'user_2' },
      'learning.candidate_duplicate',
      { agentSlug: 'pipeline-analyst', meta: { polarity: 'correct', matchedKind: 'candidate' } },
    );
  });

  it('attributes feedback with no known submitter to the system, not a person', async () => {
    await makeStep();
    judgeAnswers(null);

    await recordProposedRule({ orgId: ORG, ruleText: RULE, polarity: 'correct', stepName: STEP });

    expect(trackMock).toHaveBeenLastCalledWith(
      { orgId: ORG, userId: 'system' },
      'learning.candidate_created',
      expect.anything(),
    );
  });

  it('only compares against pending candidates, not decided ones', async () => {
    await makeStep();
    await db.insert(learningCandidateSchema).values({
      orgId: ORG,
      stepName: STEP,
      ruleText: RULE,
      status: 'rejected',
      rejectedReason: 'not how we work',
    });
    judgeAnswers(null);

    await recordProposedRule({ orgId: ORG, ruleText: RULE, polarity: 'correct', stepName: STEP });

    // A rejected candidate must not be offered to the judge — feedback would
    // otherwise attach to a rule a person already turned down. With nothing
    // else on file the shortlist is empty, so the judge is never called.
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
