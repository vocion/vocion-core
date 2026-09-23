/**
 * The bulk job row and its guards (Metacto ticket 071). The workflow itself
 * runs on Temporal; here the client is a stub, so what is under test is what
 * may enter a job, what a job that cannot start leaves behind (nothing), and
 * how outcomes settle the counters.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const workflowStart = vi.fn(async () => ({ workflowId: 'wf' }));
vi.mock('@/libs/temporal/client', () => ({
  getTemporalClient: vi.fn(async () => ({ workflow: { start: workflowStart } })),
  VOCION_WORKFLOWS_TASK_QUEUE: 'vocion-workflows',
}));

const { db } = await import('@/libs/DB');
const { leadBriefSchema, personalizationBulkJobSchema } = await import('@/models/Schema');
const { getBulkJob, recordBulkLeadOutcome, startBulkBriefRegenerate } = await import('./bulkRegenerate');

const ORG = 'org_bulk';

async function lead(id: number, name: string, status = 'ready_for_review'): Promise<number> {
  const [row] = await db.insert(leadBriefSchema).values({
    orgId: ORG,
    contactRef: `contacts:${id}`,
    contactName: name,
    triggerType: 'new',
    status,
    sections: [],
  }).returning({ id: leadBriefSchema.id });
  return row!.id;
}

beforeEach(async () => {
  workflowStart.mockClear();
  workflowStart.mockResolvedValue({ workflowId: 'wf' });
  await db.delete(personalizationBulkJobSchema);
  await db.delete(leadBriefSchema);
});

describe('startBulkBriefRegenerate', () => {
  it('creates the job with one queued outcome per lead and starts the workflow keyed to it', async () => {
    const a = await lead(1, 'Ada');
    const b = await lead(2, 'Bo');

    const res = await startBulkBriefRegenerate(ORG, { leadIds: [a, b, b], note: 'Use a Personalized Nurture rung.', by: 'usr-1' });

    expect(res.ok).toBe(true);

    const job = await getBulkJob(ORG, (res as { jobId: number }).jobId);

    expect(job).toMatchObject({ kind: 'regenerate_brief', total: 2, done: 0, failed: 0, status: 'queued', note: 'Use a Personalized Nurture rung.', createdBy: 'usr-1' });
    expect(job!.outcomes).toEqual([
      { leadId: a, contactName: 'Ada', state: 'queued' },
      { leadId: b, contactName: 'Bo', state: 'queued' },
    ]);
    expect(job!.workflowId).toBe(`bulk-brief-regenerate:${ORG}:${job!.id}`);
    expect(workflowStart).toHaveBeenCalledWith('bulkBriefRegenerate', expect.objectContaining({
      workflowId: `bulk-brief-regenerate:${ORG}:${job!.id}`,
      args: [{ orgId: ORG, jobId: job!.id, leadIds: [a, b], note: 'Use a Personalized Nurture rung.', by: 'usr-1' }],
    }));
  });

  it('refuses a lead that is not waiting in Review, by name, and starts nothing', async () => {
    const a = await lead(1, 'Ada');
    const c = await lead(3, 'Cy Handed', 'handed_off');

    const res = await startBulkBriefRegenerate(ORG, { leadIds: [a, c], note: 'x', by: 'usr-1' });

    expect(res).toMatchObject({ ok: false, reason: 'not_in_review' });
    expect((res as { message: string }).message).toContain('Cy Handed (handed off)');
    expect(workflowStart).not.toHaveBeenCalled();
    expect(await db.select().from(personalizationBulkJobSchema)).toHaveLength(0);
  });

  it('refuses a lead from another workspace and an empty list', async () => {
    const [other] = await db.insert(leadBriefSchema).values({ orgId: 'org_other', contactRef: 'contacts:9', contactName: 'Zed', triggerType: 'new', status: 'ready_for_review', sections: [] }).returning({ id: leadBriefSchema.id });

    expect(await startBulkBriefRegenerate(ORG, { leadIds: [other!.id], note: 'x', by: 'u' })).toMatchObject({ ok: false, reason: 'not_in_review' });
    expect(await startBulkBriefRegenerate(ORG, { leadIds: [], note: 'x', by: 'u' })).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('leaves no row behind when the work queue cannot be reached', async () => {
    const a = await lead(1, 'Ada');
    workflowStart.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const res = await startBulkBriefRegenerate(ORG, { leadIds: [a], note: 'x', by: 'u' });

    expect(res).toMatchObject({ ok: false, reason: 'queue_unreachable' });
    expect(await db.select().from(personalizationBulkJobSchema)).toHaveLength(0);
  });
});

describe('recordBulkLeadOutcome', () => {
  it('recomputes the counters from the outcomes, so a retried lead counts once, and marks the job done when all have settled', async () => {
    const a = await lead(1, 'Ada');
    const b = await lead(2, 'Bo');
    const res = await startBulkBriefRegenerate(ORG, { leadIds: [a, b], note: 'x', by: 'u' });
    const jobId = (res as { jobId: number }).jobId;

    await recordBulkLeadOutcome(ORG, jobId, { leadId: a, contactName: 'Ada', state: 'failed', error: 'timed out' });
    let job = await getBulkJob(ORG, jobId);

    expect(job).toMatchObject({ done: 0, failed: 1, status: 'running' });

    // Temporal's retry lands the same lead: the failure is overwritten, not added to.
    await recordBulkLeadOutcome(ORG, jobId, { leadId: a, contactName: 'Ada', state: 'landed' });
    await recordBulkLeadOutcome(ORG, jobId, { leadId: b, contactName: 'Bo', state: 'landed' });
    job = await getBulkJob(ORG, jobId);

    expect(job).toMatchObject({ done: 2, failed: 0, status: 'done' });
    expect(job!.outcomes.find(o => o.leadId === a)).toMatchObject({ state: 'landed' });
    expect(job!.outcomes.find(o => o.leadId === a)!.error).toBeUndefined();
  });
});
