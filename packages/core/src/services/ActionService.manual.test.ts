/**
 * Hand-off actions against PGlite: the state machine (pending → released →
 * done | rejected), nothing executed in-process at any step, and the trust
 * rules the factory ships binding to the registered ids — including the one
 * merge id earning per risk class.
 */
import type { Principal } from '@/services/authz';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, autonomyPolicySchema, trustRuleSchema } = await import('@/models/Schema');
const { getAction } = await import('@/libs/actions/registry');
const { completeAction, executeAction, proposeAction, rejectAction } = await import('@/services/ActionService');
const { eq } = await import('drizzle-orm');

const ORG = 'org_handoff';

function agent(): Principal {
  return { kind: 'agent', id: 'agent:factory-lead', grants: ['factory_write'], autonomy: 2, scope: { orgId: ORG } };
}

const recipe = { title: 'Provision the staging queue', summary: 'The ingestion lead needs a queue before the next task can run.', recipe: 'aws sqs create-queue --queue-name vocion-staging-ingest', evidence: ['https://example.test/task/17'] };

function propose(actionId: string, confidence: number, input: Record<string, unknown> = recipe) {
  return proposeAction({
    orgId: ORG,
    actionId,
    input,
    principal: agent(),
    proposal: { confidence, rationale: 'the task contract names it', suggestedDecision: 'approve', suggestedDecisionReason: 'named in the task contract' },
  });
}

async function readRun(runId: number) {
  const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, runId));
  return row!;
}

/**
 * The plugin's rule for a kind, as `workspace:apply` mirrors it into both tables.
 * @param actionId
 * @param opts
 * @param opts.rung
 * @param opts.risk
 * @param opts.above
 * @param opts.enabled
 */
async function rule(actionId: string, opts: { rung: string; risk: 'low' | 'medium' | 'high'; above: number; enabled: boolean }) {
  await db.insert(trustRuleSchema).values({ orgId: ORG, actionId, threshold: opts.above, enabled: opts.enabled ? 'true' : 'false' });
  await db.insert(autonomyPolicySchema).values({ orgId: ORG, actionId, rung: opts.rung, riskTier: opts.risk, minConfidence: opts.above, source: 'trust.yaml' });
}

beforeEach(async () => {
  await db.delete(actionRunSchema);
  await db.delete(trustRuleSchema);
  await db.delete(autonomyPolicySchema);
});

afterAll(async () => {
  await db.delete(actionRunSchema);
  await db.delete(trustRuleSchema);
  await db.delete(autonomyPolicySchema);
});

describe('a hand-off action', () => {
  it('is proposed like any other kind and lands pending', async () => {
    const out = await propose('deploy.provision', 0.9);

    expect(out).toMatchObject({ status: 'pending', outcome: 'created' });
    expect((await readRun(out.runId)).actionId).toBe('deploy.provision');
  });

  it('approving releases it — awaiting_execution, decided by the approver, nothing run', async () => {
    const execute = vi.spyOn(getAction('deploy.provision')!, 'execute');
    const out = await propose('deploy.provision', 0.9);

    const released = await executeAction(out.runId, ORG, { reviewedBy: 'usr_chris' });

    expect(released.status).toBe('awaiting_execution');
    expect(execute).not.toHaveBeenCalled();

    const row = await readRun(out.runId);

    expect(row.status).toBe('awaiting_execution');
    expect(row.decidedBy).toBe('usr_chris');
    expect(row.decidedAt).toBeInstanceOf(Date);
    expect(row.executedAt).toBeNull();
    expect(row.result).toMatchObject({ handoff: { releasedBy: 'usr_chris' } });
    expect(typeof (row.result as { handoff: { releasedAt: string } }).handoff.releasedAt).toBe('string');

    execute.mockRestore();
  });

  it('marking it done records who, when, the note and the result URL', async () => {
    const out = await propose('deploy.provision', 0.9);
    await executeAction(out.runId, ORG, { reviewedBy: 'usr_chris' });

    const done = await completeAction(out.runId, ORG, { by: 'token:ci', note: 'applied from the runner', resultUrl: 'https://example.test/queues/vocion-staging-ingest' });

    expect(done.status).toBe('done');

    const row = await readRun(out.runId);

    expect(row.status).toBe('done');
    expect(row.executedAt).toBeInstanceOf(Date);
    // The approver's decision stands; the doer is recorded on the execution.
    expect(row.decidedBy).toBe('usr_chris');
    expect(row.result).toMatchObject({
      handoff: { releasedBy: 'usr_chris' },
      executed: { by: 'token:ci', note: 'applied from the runner', resultUrl: 'https://example.test/queues/vocion-staging-ingest' },
    });
  });

  it('cannot be marked done before it is released, or twice, or when it runs in-process', async () => {
    const out = await propose('deploy.provision', 0.9);

    await expect(completeAction(out.runId, ORG, { by: 'usr_chris' })).rejects.toMatchObject({ code: 'INVALID_STATE' });

    await executeAction(out.runId, ORG, { reviewedBy: 'usr_chris' });
    await completeAction(out.runId, ORG, { by: 'usr_chris' });

    await expect(completeAction(out.runId, ORG, { by: 'usr_chris' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(completeAction(out.runId, 'org_other', { by: 'usr_chris' })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // An in-process kind has nothing to mark done by hand.
    const [wiki] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'wiki.write_page', input: {}, status: 'awaiting_execution' }).returning({ id: actionRunSchema.id });

    await expect(completeAction(wiki!.id, ORG, { by: 'usr_chris' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('rejects as today — before release, and after it when the work could not be done', async () => {
    const a = await propose('credentials.write', 0.9);
    await rejectAction(a.runId, ORG, 'not this key', { reviewedBy: 'usr_chris' });

    expect(await readRun(a.runId)).toMatchObject({ status: 'rejected', error: 'not this key', decidedBy: 'usr_chris' });

    const b = await propose('credentials.write', 0.9, { ...recipe, title: 'Rotate the deploy key' });
    await executeAction(b.runId, ORG, { reviewedBy: 'usr_chris' });
    await rejectAction(b.runId, ORG, 'the vault refused the write', { reviewedBy: 'usr_chris' });

    expect(await readRun(b.runId)).toMatchObject({ status: 'rejected', error: 'the vault refused the write' });
    await expect(completeAction(b.runId, ORG, { by: 'usr_chris' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});

describe('the factory trust rules bind to the registered ids', () => {
  it('deploy.provision cannot auto-approve at confidence 1.0 when the rule says approval', async () => {
    await rule('deploy.provision', { rung: 'execute-with-approval', risk: 'high', above: 1, enabled: false });

    const out = await propose('deploy.provision', 1);

    expect(out.status).toBe('pending');

    const row = await readRun(out.runId);

    expect(row.status).toBe('pending');
    expect(row.approvedByAgent).toBeNull();
    expect(row.decidedBy).toBeNull();
  });

  it('with no rule at all, an irreversible hand-off still asks — even at 1.0', async () => {
    const out = await propose('deploy.release', 1);

    expect(out.status).toBe('pending');
  });

  it('git.push_branch, reversible and promoted by the rule, is released on its own above 0.7 and waits below', async () => {
    await rule('git.push_branch', { rung: 'execute-within-bounds', risk: 'low', above: 0.7, enabled: true });

    const released = await propose('git.push_branch', 0.8, { ...recipe, title: 'Push feat/task-17' });

    expect(released.status).toBe('awaiting_execution');

    const row = await readRun(released.runId);

    expect(row.approvedByAgent).toBe(true);
    expect(row.decidedBy).toBe('agent:factory-lead');
    expect(row.result).toMatchObject({ handoff: { releasedBy: 'agent:factory-lead' } });

    const held = await propose('git.push_branch', 0.6, { ...recipe, title: 'Push feat/task-18' });

    expect(held.status).toBe('pending');
  });

  it('one git.merge id, ten ledgers: docs can be promoted while schema never releases', async () => {
    await rule('git.merge.docs', { rung: 'execute-within-bounds', risk: 'medium', above: 0.95, enabled: true });
    await rule('git.merge.schema', { rung: 'execute-with-approval', risk: 'high', above: 1, enabled: false });

    const docs = await propose('git.merge', 0.96, { ...recipe, commitSha: 'a1b2c3d4e5f6', rollback: 'revert the merge commit and redeploy; no data written', title: 'Merge docs', riskClass: 'docs' });
    const schema = await propose('git.merge', 1, { ...recipe, commitSha: 'a1b2c3d4e5f6', rollback: 'revert the merge commit and redeploy; no data written', title: 'Merge schema', riskClass: 'schema' });
    const unruled = await propose('git.merge', 1, { ...recipe, commitSha: 'a1b2c3d4e5f6', rollback: 'revert the merge commit and redeploy; no data written', title: 'Merge ui', riskClass: 'ui' });

    expect(docs.status).toBe('awaiting_execution');
    expect((await readRun(docs.runId)).proposal).toMatchObject({ autoApprovedBy: 'trust-rule' });
    expect(schema.status).toBe('pending');
    // No rule for the class: an irreversible hand-off asks.
    expect(unruled.status).toBe('pending');
  });
});
