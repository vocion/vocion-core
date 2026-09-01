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

const { db } = await import('@/libs/DB');
const { feedbackJobSchema, learningCandidateSchema, learningSchema } = await import('@/models/Schema');
const { enqueue, listJobs, runOnce } = await import('@/services/FeedbackWorkerService');

const ORG = 'org_feedback';
const OTHER_ORG = 'org_not_yours';

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(learningCandidateSchema);
  await db.delete(learningSchema);
  await db.delete(feedbackJobSchema);
});

afterAll(async () => {
  await db.delete(learningCandidateSchema);
  await db.delete(learningSchema);
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

    expect(await db.select().from(learningSchema)).toHaveLength(0);
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
});
