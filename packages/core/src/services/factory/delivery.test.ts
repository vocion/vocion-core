import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

/**
 * THE MERGE, WRITTEN ON THE REQUEST IT CARRIED (#269, 2026-09-30): on
 * `pr.merged` the request gets its delivery — who merged it, when, the runs
 * the merge started — and its stale recovery line clears; the reconcile
 * writes a merge whose webhook never did, and reads running runs again.
 * Fictional Northwind fixture; GitHub is injected.
 */

const { db } = await import('@/libs/DB');
const { actionRunSchema, agentSchema, businessObjectSchema, businessObjectTypeSchema, eventLogSchema, userSchema } = await import('@/models/Schema');
const { recordMerge, refreshDeliveries } = await import('./delivery');

const ORG = 'org_delivery_northwind';
const PR = 'https://github.com/northwind/share/pull/41';
const NOW = new Date();

let listed: Array<Record<string, unknown>> = [];
const deps = { runsOn: vi.fn(async () => listed as never) };

async function type(slug: string): Promise<number> {
  const [row] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug, label: slug }).returning({ id: businessObjectTypeSchema.id });
  return row!.id;
}

async function meta(id: number): Promise<Record<string, unknown>> {
  const [row] = await db.select({ metadata: businessObjectSchema.metadata }).from(businessObjectSchema).where(eq(businessObjectSchema.id, id));
  return (row!.metadata ?? {}) as Record<string, unknown>;
}

let requestId = 0;
let taskId = 0;

beforeEach(async () => {
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  await db.delete(actionRunSchema);
  await db.delete(eventLogSchema);
  deps.runsOn.mockClear();
  listed = [{ id: 9001, name: 'Deploy', run_number: 512, html_url: 'https://github.com/northwind/share/actions/runs/9001', status: 'in_progress', conclusion: null, run_started_at: '2026-09-30T22:38:11Z', head_sha: 'a1b2c3d4' }];
  const [req] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: await type('request'), title: 'Visitors switch the theme', metadata: { state: 'building', recovery: { stage: 'recovering', line: 'Recovering (attempt 2 of 3): QA sent attempt #271 back', attempts: [], log: [], limit: 3 } } }).returning({ id: businessObjectSchema.id });
  requestId = req!.id;
  const [task] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: await type('engineering_task'), title: 'Theme switch', status: 'accepted', metadata: { requestId, prUrl: PR } }).returning({ id: businessObjectSchema.id });
  taskId = task!.id;
});

const merged = { url: PR, repo: 'northwind/share', mergeSha: 'a1b2c3d4', mergedAt: new Date(NOW.getTime() - 3_600_000).toISOString(), mergedBy: 'dana-reyes', author: 'factory-bot' };

describe('recordMerge', () => {
  it('writes who merged it, when and the run it started, and settles the recovery line', async () => {
    const out = await recordMerge(ORG, merged, deps, NOW);

    expect(out).toEqual([{ requestId, did: 'recorded' }]);

    const m = await meta(requestId);

    expect(m.delivery).toMatchObject({ prUrl: PR, pr: 'PR #41', mergedBy: 'dana-reyes', mergeSha: 'a1b2c3d4', runs: [{ runId: 9001, name: 'Deploy', runNumber: 512, status: 'in_progress' }] });
    expect(m.recovery).toMatchObject({ stage: null, line: null });
    expect(((m.recovery as { log: Array<{ text: string }> }).log.at(-1))?.text).toBe('Merged PR #41 by dana-reyes; the runs it started on GitHub carry it to the release.');
    // Idempotent: the same merge again reads nothing and writes nothing new.
    expect(await recordMerge(ORG, merged, deps, NOW)).toEqual([{ requestId, did: 'already recorded' }]);
  });

  it('names the person who pressed Merge on the card, by name, over GitHub\'s login', async () => {
    const [u] = await db.insert(userSchema).values({ id: 'usr-delivery-dana', email: 'dana@northwind.example', name: 'Dana Reyes' } as never).returning({ id: userSchema.id });
    await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'git.merge', status: 'done', input: { taskId }, decidedBy: u!.id, decidedAt: new Date() } as never);

    await recordMerge(ORG, merged, deps, NOW);

    expect((await meta(requestId)).delivery).toMatchObject({ mergedBy: 'Dana Reyes' });
  });

  it('a merge Vocion made says Vocion and the seat that approved it, never the token\'s owner (run 2, 2026-10-01)', async () => {
    await db.insert(agentSchema).values({ orgId: ORG, slug: 'change-reviewer', name: 'QA', systemPrompt: 'x' } as never).onConflictDoNothing();
    await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'git.merge', status: 'done', input: { taskId }, invokedBy: 'agent:change-reviewer', decidedBy: 'agent:change-reviewer', decidedAt: new Date(), proposal: { agentSlug: 'change-reviewer', autoApproved: true, autoApprovedBy: 'trust-rule', autoApprovedReason: 'trust rule: 90% ≥ 85%' } } as never);

    await recordMerge(ORG, { ...merged, mergedBy: 'token-owner' }, deps, NOW);
    const m = await meta(requestId);

    expect(m.delivery).toMatchObject({ mergedBy: 'Vocion · QA approved · trust rule' });
    expect(((m.recovery as { log: Array<{ text: string }> }).log.at(-1))?.text).toBe('Merged PR #41 by Vocion · QA approved · trust rule; the runs it started on GitHub carry it to the release.');
  });

  it('credits Vocion, QA\'s count and the trust rule while the merge run is still executing, never the token\'s owner (Walk 10, PR #180)', async () => {
    // git.merge raises pr.merged from inside its own execution: the run reads
    // `executing` when the event is handled, and a done-only read fell through
    // to GitHub's merged_by ("Merged PR #180 by <token owner>").
    await db.insert(agentSchema).values({ orgId: ORG, slug: 'change-reviewer', name: 'QA', systemPrompt: 'x' } as never).onConflictDoNothing();
    await db.update(businessObjectSchema).set({ metadata: { requestId, prUrl: PR, verdict: { value: 'approve', proven: 6, total: 6 } } }).where(eq(businessObjectSchema.id, taskId));
    await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'git.merge', status: 'executing', input: { taskId, riskClass: 'logic' }, invokedBy: 'agent:change-reviewer', decidedBy: 'agent:change-reviewer', decidedAt: new Date(), proposal: { agentSlug: 'change-reviewer', autoApproved: true, autoApprovedBy: 'trust-rule', autoApprovedReason: 'trust rule: 90% ≥ 85%' } } as never);

    await recordMerge(ORG, { ...merged, mergedBy: 'token-owner' }, deps, NOW);
    const m = await meta(requestId);

    expect(m.delivery).toMatchObject({ mergedBy: 'Vocion · QA approved 6 of 6 · trust rule (logic)' });
    expect(((m.recovery as { log: Array<{ text: string }> }).log.at(-1))?.text).toBe('Merged PR #41 by Vocion · QA approved 6 of 6 · trust rule (logic); the runs it started on GitHub carry it to the release.');
    expect(JSON.stringify(m)).not.toContain('token-owner');
  });

  it('a person who pressed Merge is credited while the run is still executing', async () => {
    const [u] = await db.insert(userSchema).values({ id: 'usr-delivery-ines', email: 'ines@northwind.example', name: 'Ines Okafor' } as never).returning({ id: userSchema.id });
    await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'git.merge', status: 'executing', input: { taskId }, invokedBy: 'agent:change-reviewer', decidedBy: u!.id, decidedAt: new Date() } as never);

    await recordMerge(ORG, { ...merged, mergedBy: 'token-owner' }, deps, NOW);

    expect((await meta(requestId)).delivery).toMatchObject({ mergedBy: 'Ines Okafor' });
  });

  it('a merge a trust rule released with no seat behind it names the rule', async () => {
    await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'git.merge', status: 'done', input: { taskId }, invokedBy: 'system:reconcile', decidedBy: 'trust-ladder', decidedAt: new Date(), proposal: { autoApproved: true, autoApprovedReason: 'trust rule: 90% ≥ 85%' } } as never);

    await recordMerge(ORG, { ...merged, mergedBy: 'token-owner' }, deps, NOW);

    expect((await meta(requestId)).delivery).toMatchObject({ mergedBy: 'Vocion · trust rule: 90% ≥ 85%' });
  });

  it('a pull request no attempt carried writes nothing', async () => {
    expect(await recordMerge(ORG, { ...merged, url: 'https://github.com/northwind/share/pull/99' }, deps, NOW)).toEqual([]);
  });
});

describe('refreshDeliveries (the reconcile)', () => {
  it('writes a merge heard as an event but never written, then reads the runs again until they finish', async () => {
    await db.insert(eventLogSchema).values({ orgId: ORG, type: 'pr.merged', payload: merged, dedupeKey: 'github:northwind/share#41:pr.merged:f00d' });

    expect(await refreshDeliveries(ORG, NOW, deps)).toEqual([{ requestId, did: 'merge recorded by the reconcile' }]);

    listed = [{ ...listed[0]!, status: 'completed', conclusion: 'success' }];

    expect(await refreshDeliveries(ORG, NOW, deps)).toEqual([{ requestId, did: 'runs read again' }]);
    expect((await meta(requestId)).delivery).toMatchObject({ runs: [{ status: 'completed', conclusion: 'success' }] });

    // Finished: nothing more to read.
    deps.runsOn.mockClear();
    await refreshDeliveries(ORG, NOW, deps);

    expect(deps.runsOn).not.toHaveBeenCalled();
  });
});

describe('a failed deploy on the merge (#294)', () => {
  it('names the step that failed, once, and keeps reading the run so a re-run that passes is the deploy', async () => {
    await db.insert(eventLogSchema).values({ orgId: ORG, type: 'pr.merged', payload: merged, dedupeKey: 'github:northwind/share#41:pr.merged:f00e' });
    listed = [{ ...listed[0]!, status: 'completed', conclusion: 'failure' }];
    const jobs = vi.fn(async () => [{ name: 'changes', failedStep: null }, { name: 'deploy', failedStep: 'API' }]);

    await refreshDeliveries(ORG, NOW, { ...deps, jobs });

    expect((await meta(requestId)).delivery).toMatchObject({ runs: [{ runId: 9001, conclusion: 'failure', failedStep: 'API' }] });

    // Read again while it stands failed: the step is not read twice.
    await refreshDeliveries(ORG, NOW, { ...deps, jobs });

    expect(jobs).toHaveBeenCalledTimes(1);

    // The re-run: the same run is going again, then passes.
    listed = [{ ...listed[0]!, status: 'in_progress', conclusion: null }];

    expect(await refreshDeliveries(ORG, NOW, { ...deps, jobs })).toEqual([{ requestId, did: 'runs read again' }]);

    listed = [{ ...listed[0]!, status: 'completed', conclusion: 'success' }];
    await refreshDeliveries(ORG, NOW, { ...deps, jobs });

    expect((await meta(requestId)).delivery).toMatchObject({ runs: [{ status: 'completed', conclusion: 'success' }] });
  });
});
