/**
 * The feedback worker against PGlite. The behaviour worth pinning down is the
 * hand-off: a classification that proposes a rule becomes a pending learning
 * candidate, and never a live rule.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const classifyComment = vi.fn();
vi.mock('@/services/feedback/classifier', () => ({
  classifyComment: (...args: unknown[]) => classifyComment(...args),
}));

// Only the model call is replaced; reading and describing the corrections stay real.
const proposeEditLearnings = vi.fn();
vi.mock('@/services/feedback/editLearning', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/feedback/editLearning')>()),
  proposeEditLearnings: (...args: unknown[]) => proposeEditLearnings(...args),
}));

const { db } = await import('@/libs/DB');
const { feedbackJobSchema, learningCandidateSchema, learningFeedbackOccurrenceSchema, memoryNamespaceSchema, memorySchema } = await import('@/models/Schema');
const { enqueue, listJobs, runOnce } = await import('@/services/FeedbackWorkerService');

const ORG = 'org_feedback';
const OTHER_ORG = 'org_not_yours';

beforeEach(async () => {
  vi.clearAllMocks();
  proposeEditLearnings.mockResolvedValue([]);
  await db.delete(learningFeedbackOccurrenceSchema);
  await db.delete(learningCandidateSchema);
  await db.delete(memorySchema);
  await db.delete(memoryNamespaceSchema);
  await db.delete(feedbackJobSchema);
});

afterAll(async () => {
  await db.delete(learningFeedbackOccurrenceSchema);
  await db.delete(learningCandidateSchema);
  await db.delete(memorySchema);
  await db.delete(memoryNamespaceSchema);
  await db.delete(feedbackJobSchema);
});

describe('enqueue', () => {
  it('queues a job', async () => {
    const job = await enqueue({
      orgId: ORG,
      source: 'api',
      externalId: 'panel-1',
      payload: { text: 'Always cite the source line.', targetSlug: 'crm-updates' },
    });

    expect(job.status).toBe('queued');
    expect(job.source).toBe('api');
  });

  it('is idempotent on (org, source, externalId)', async () => {
    const first = await enqueue({ orgId: ORG, source: 'api', externalId: 'panel-1', payload: { text: 'one' } });
    const second = await enqueue({ orgId: ORG, source: 'api', externalId: 'panel-1', payload: { text: 'two' } });

    expect(second.id).toBe(first.id);
    expect(await db.select().from(feedbackJobSchema)).toHaveLength(1);
  });

  it('treats the same external id in another org as a different job', async () => {
    const mine = await enqueue({ orgId: ORG, source: 'api', externalId: 'panel-1', payload: { text: 'one' } });
    const theirs = await enqueue({ orgId: OTHER_ORG, source: 'api', externalId: 'panel-1', payload: { text: 'one' } });

    expect(theirs.id).not.toBe(mine.id);
  });
});

describe('listJobs', () => {
  it('filters by status and source, scoped to the org', async () => {
    await enqueue({ orgId: ORG, source: 'api', externalId: 'a', payload: { text: 'one' } });
    await enqueue({ orgId: ORG, source: 'manual', externalId: 'b', payload: { text: 'two' } });
    await enqueue({ orgId: OTHER_ORG, source: 'api', externalId: 'c', payload: { text: 'three' } });

    expect((await listJobs(ORG)).total).toBe(2);
    expect((await listJobs(ORG, { source: 'api' })).total).toBe(1);
    expect((await listJobs(ORG, { status: 'classified' })).total).toBe(0);
  });

  it('pages without changing the total', async () => {
    await enqueue({ orgId: ORG, source: 'api', externalId: 'a', payload: { text: 'one' } });
    await enqueue({ orgId: ORG, source: 'api', externalId: 'b', payload: { text: 'two' } });

    const page = await listJobs(ORG, { limit: 1, offset: 0 });

    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(2);
  });
});

describe('runOnce', () => {
  it('records a pending candidate when the classifier proposes a rule', async () => {
    classifyComment.mockResolvedValue({ bucket: 'rule', rule_text: 'Always cite the source line.' });
    await enqueue({
      orgId: ORG,
      source: 'api',
      externalId: 'panel-1',
      payload: { text: 'Always cite the source line, going forward.', targetSlug: 'crm-updates' },
    });

    expect(await runOnce()).toBe(true);

    const candidates = await db.select().from(learningCandidateSchema);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.status).toBe('pending');
    expect(candidates[0]!.stepName).toBe('crm-updates');
    expect(candidates[0]!.ruleText).toBe('Always cite the source line.');
  });

  it('never writes a live rule on its own', async () => {
    classifyComment.mockResolvedValue({ bucket: 'rule', rule_text: 'Always cite the source line.' });
    await enqueue({ orgId: ORG, source: 'api', externalId: 'p', payload: { text: 'x', targetSlug: 'crm-updates' } });

    await runOnce();

    expect(await db.select().from(memorySchema)).toHaveLength(0);
  });

  it('classifies without a candidate when the feedback names no target step', async () => {
    classifyComment.mockResolvedValue({ bucket: 'rule', rule_text: 'Always cite the source line.' });
    await enqueue({ orgId: ORG, source: 'api', externalId: 'p', payload: { text: 'x' } });

    await runOnce();

    expect(await db.select().from(learningCandidateSchema)).toHaveLength(0);
    expect((await listJobs(ORG, { status: 'classified' })).total).toBe(1);
  });

  it('records no candidate for an edit-only classification', async () => {
    classifyComment.mockResolvedValue({ bucket: 'edit', edit_summary: 'shorten it' });
    await enqueue({ orgId: ORG, source: 'api', externalId: 'p', payload: { text: 'x', targetSlug: 'crm-updates' } });

    await runOnce();

    expect(await db.select().from(learningCandidateSchema)).toHaveLength(0);
  });

  it('marks the job failed when the classifier throws', async () => {
    classifyComment.mockRejectedValue(new Error('model unavailable'));
    await enqueue({ orgId: ORG, source: 'api', externalId: 'p', payload: { text: 'x', targetSlug: 'crm-updates' } });

    await runOnce();

    const [job] = await db.select().from(feedbackJobSchema);

    expect(job!.status).toBe('failed');
    expect(job!.error).toContain('model unavailable');
  });

  it('reports there was nothing to do on an empty queue', async () => {
    expect(await runOnce()).toBe(false);
  });

  it('hands the classifier the org step whitelist so it can pick the bucket', async () => {
    await db.insert(memoryNamespaceSchema).values([
      { orgId: ORG, name: 'crm-updates', path: 'workspace/crm-updates', title: 'CRM update judgment', description: 'When to write to the CRM' },
      { orgId: ORG, name: 'email-drafting', path: 'workspace/email-drafting', title: 'Email drafting', description: 'Voice and structure of outbound email' },
    ]);
    classifyComment.mockResolvedValue({ bucket: 'ignore' });
    await enqueue({ orgId: ORG, source: 'api', externalId: 'p', payload: { text: 'x' } });

    await runOnce();

    expect(classifyComment).toHaveBeenCalledWith(expect.objectContaining({
      steps: [
        { name: 'crm-updates', description: 'When to write to the CRM' },
        { name: 'email-drafting', description: 'Voice and structure of outbound email' },
      ],
    }));
  });

  it('lands the candidate in the step the classifier picked when the payload names none', async () => {
    await db.insert(memoryNamespaceSchema).values([
      { orgId: ORG, name: 'crm-updates', path: 'workspace/crm-updates', title: 'CRM update judgment', description: 'When to write to the CRM' },
      { orgId: ORG, name: 'email-drafting', path: 'workspace/email-drafting', title: 'Email drafting', description: 'Voice of outbound email' },
    ]);
    classifyComment.mockResolvedValue({
      bucket: 'rule',
      rule_text: 'Keep follow-up emails under 120 words.',
      target_step: 'email-drafting',
    });
    await enqueue({ orgId: ORG, source: 'api', externalId: 'p', payload: { text: 'shorter emails please' } });

    await runOnce();

    const [candidate] = await db.select().from(learningCandidateSchema);

    expect(candidate!.stepName).toBe('email-drafting');
  });

  it('lets a payload that names the step win over the classifier pick', async () => {
    await db.insert(memoryNamespaceSchema).values([
      { orgId: ORG, name: 'crm-updates', path: 'workspace/crm-updates', title: 'CRM update judgment', description: 'When to write to the CRM' },
      { orgId: ORG, name: 'email-drafting', path: 'workspace/email-drafting', title: 'Email drafting', description: 'Voice of outbound email' },
    ]);
    classifyComment.mockResolvedValue({
      bucket: 'rule',
      rule_text: 'Keep follow-up emails under 120 words.',
      target_step: 'email-drafting',
    });
    await enqueue({ orgId: ORG, source: 'api', externalId: 'p', payload: { text: 'x', targetSlug: 'crm-updates' } });

    await runOnce();

    const [candidate] = await db.select().from(learningCandidateSchema);

    expect(candidate!.stepName).toBe('crm-updates');
  });
});

describe('runOnce — typed, scoped candidates (Phase 2)', () => {
  it('resolves the classifier scope kind against the feedback own refs', async () => {
    await db.insert(memoryNamespaceSchema).values(
      { orgId: ORG, name: 'global', path: 'workspace/global', title: 'Global', description: 'Workspace rules' },
    );
    classifyComment.mockResolvedValue({
      bucket: 'rule',
      rule_text: 'Keep replies under three sentences for me.',
      memory_type: 'preference',
      scope: 'user',
    });
    await enqueue({
      orgId: ORG,
      source: 'chat',
      externalId: 'pref-1',
      payload: { text: 'shorter please, always', submittedBy: 'user_jamie' },
    });

    await runOnce();

    const [candidate] = await db.select().from(learningCandidateSchema);

    expect(candidate).toMatchObject({ memoryType: 'preference', scopeKind: 'user', scopeRef: 'user_jamie' });
  });

  it('falls back to workspace scope when the kind has no ref to attach to', async () => {
    await db.insert(memoryNamespaceSchema).values(
      { orgId: ORG, name: 'global', path: 'workspace/global', title: 'Global', description: 'Workspace rules' },
    );
    classifyComment.mockResolvedValue({
      bucket: 'rule',
      rule_text: 'Always cite the source line.',
      memory_type: 'procedure',
      scope: 'agent',
    });
    await enqueue({ orgId: ORG, source: 'api', externalId: 'no-ref', payload: { text: 'cite sources' } });

    await runOnce();

    const [candidate] = await db.select().from(learningCandidateSchema);

    expect(candidate).toMatchObject({ memoryType: 'procedure', scopeKind: null, scopeRef: null });
  });
});

describe('runOnce with field corrections', () => {
  const CATEGORY_EDIT = { field: 'categories', before: ['Live Music', 'Jazz Brunch'], after: ['Live Music', 'Food & Drink'] };
  const BRUNCH_RULE = 'File brunch listings at Pier Hall under Food & Drink.';

  it('learns from corrections a reviewer made without typing a word, and spends no call on the empty comment', async () => {
    proposeEditLearnings.mockResolvedValue([{ field: 'categories', ruleText: BRUNCH_RULE, memoryType: 'knowledge' }]);
    await enqueue({
      orgId: ORG,
      source: 'api',
      externalId: 'review-7',
      payload: {
        text: '',
        edits: [CATEGORY_EDIT],
        quotedText: 'title: "Harbor Jazz Brunch"',
        artifactTitle: 'Harbor Jazz Brunch',
        targetSlug: 'event-extraction',
        agentSlug: 'listings-agent',
        sourceRunId: 7,
        submittedBy: 'reviewer@example.com',
      },
    });

    await runOnce();

    expect(classifyComment).not.toHaveBeenCalled();
    expect(proposeEditLearnings).toHaveBeenCalledWith(expect.objectContaining({
      edits: [CATEGORY_EDIT],
      note: '',
      quotedText: 'title: "Harbor Jazz Brunch"',
      orgId: ORG,
    }));

    const [job] = await db.select().from(feedbackJobSchema);

    expect(job!.status).toBe('classified');
    // What became of the learning is on the job, so a report can count candidates made.
    expect(job!.classification).toMatchObject({
      bucket: 'ignore',
      editLearnings: [{ field: 'categories', ruleText: BRUNCH_RULE, outcome: 'created', candidateId: expect.any(Number) }],
    });

    const [candidate] = await db.select().from(learningCandidateSchema);

    expect(candidate).toMatchObject({
      status: 'pending',
      stepName: 'event-extraction',
      ruleText: BRUNCH_RULE,
      polarity: 'correct',
      memoryType: 'knowledge',
      sourceRunId: 7,
    });

    // The person deciding sees the correction the rule came from.
    const [occurrence] = await db.select().from(learningFeedbackOccurrenceSchema);

    expect(occurrence!.note).toBe('Corrected categories: "Live Music, Jazz Brunch" became "Live Music, Food & Drink".');
    expect(occurrence!.submittedBy).toBe('reviewer@example.com');
  });

  it('tells the edit reader what rule the note already became, so it is not filed twice', async () => {
    classifyComment.mockResolvedValue({ bucket: 'rule', rule_text: BRUNCH_RULE });
    await enqueue({
      orgId: ORG,
      source: 'api',
      externalId: 'review-8',
      payload: { text: 'Pier Hall brunches are food events.', edits: [CATEGORY_EDIT], targetSlug: 'event-extraction' },
    });

    await runOnce();

    expect(proposeEditLearnings).toHaveBeenCalledWith(expect.objectContaining({
      note: 'Pier Hall brunches are food events.',
      noteRule: BRUNCH_RULE,
    }));
    expect(await db.select().from(learningCandidateSchema)).toHaveLength(1);
  });

  it('keeps the note with the correction as evidence when there was one', async () => {
    classifyComment.mockResolvedValue({ bucket: 'ignore' });
    proposeEditLearnings.mockResolvedValue([{ field: 'categories', ruleText: BRUNCH_RULE }]);
    await enqueue({
      orgId: ORG,
      source: 'api',
      externalId: 'review-9',
      payload: { text: 'Fixed the category.', edits: [CATEGORY_EDIT], targetSlug: 'event-extraction' },
    });

    await runOnce();

    const [occurrence] = await db.select().from(learningFeedbackOccurrenceSchema);

    expect(occurrence!.note).toBe('Corrected categories: "Live Music, Jazz Brunch" became "Live Music, Food & Drink". Fixed the category.');
  });

  it('records nothing when the corrections teach nothing, and says so on the job', async () => {
    await enqueue({
      orgId: ORG,
      source: 'api',
      externalId: 'review-10',
      payload: { text: '', edits: [{ field: 'price', before: '$10', after: '$12' }], targetSlug: 'event-extraction' },
    });

    await runOnce();

    const [job] = await db.select().from(feedbackJobSchema);

    expect(job!.classification).toMatchObject({ editLearnings: [] });
    expect(await db.select().from(learningCandidateSchema)).toHaveLength(0);
  });

  it('fails a job whose corrections cannot be read, instead of dropping them quietly', async () => {
    await enqueue({
      orgId: ORG,
      source: 'review',
      externalId: 'review-11',
      payload: { text: '', edits: 'categories changed' as unknown as [], targetSlug: 'event-extraction' },
    });

    await runOnce();

    const [job] = await db.select().from(feedbackJobSchema);

    expect(job!.status).toBe('failed');
    expect(job!.error).toContain('payload.edits must be an array');
    expect(proposeEditLearnings).not.toHaveBeenCalled();
  });

  it('still records the note\'s rule when reading the corrections fails, and says so on the job', async () => {
    classifyComment.mockResolvedValue({ bucket: 'rule', rule_text: BRUNCH_RULE });
    proposeEditLearnings.mockRejectedValue(new Error('model unavailable'));
    await enqueue({
      orgId: ORG,
      source: 'api',
      externalId: 'review-12',
      payload: { text: 'Pier Hall brunches are food events.', edits: [CATEGORY_EDIT], targetSlug: 'event-extraction' },
    });

    await runOnce();

    const [job] = await db.select().from(feedbackJobSchema);

    expect(job!.status).toBe('classified');
    expect(job!.classification).toMatchObject({ editLearningError: 'model unavailable' });
    expect((await db.select().from(learningCandidateSchema)).map(candidate => candidate.ruleText)).toEqual([BRUNCH_RULE]);
  });

  it('fails a corrections-only job when reading the corrections fails, since they were all it carried', async () => {
    proposeEditLearnings.mockRejectedValue(new Error('model unavailable'));
    await enqueue({
      orgId: ORG,
      source: 'api',
      externalId: 'review-13',
      payload: { text: '', edits: [CATEGORY_EDIT], targetSlug: 'event-extraction' },
    });

    await runOnce();

    const [job] = await db.select().from(feedbackJobSchema);

    expect(job!.status).toBe('failed');
    expect(job!.error).toContain('model unavailable');
  });

  it('files a preference read from a correction under the person who made it', async () => {
    proposeEditLearnings.mockResolvedValue([{ field: 'categories', ruleText: BRUNCH_RULE, memoryType: 'preference' }]);
    await enqueue({
      orgId: ORG,
      source: 'api',
      externalId: 'review-14',
      payload: { text: '', edits: [CATEGORY_EDIT], targetSlug: 'event-extraction', submittedBy: 'user_jamie' },
    });

    await runOnce();

    const [candidate] = await db.select().from(learningCandidateSchema);

    expect(candidate).toMatchObject({ memoryType: 'preference', scopeKind: 'user', scopeRef: 'user_jamie' });
  });
});
