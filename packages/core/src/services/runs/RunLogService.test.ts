import process from 'node:process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.VOCION_TOOL_SIGNING_SECRET ??= 'test-signing-secret';
process.env.VOCION_EXTERNAL_WORKERS = '1';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { missionRunSchema, toolCallSchema, workerRunEventSchema, workerRunSchema } = await import('@/models/Schema');
const svc = await import('./RunLogService');
const runs = await import('@/services/WorkerRunService');

const ORG = 'org_run_log';
const OTHER = 'org_run_log_other';

async function runningRun(orgId = ORG) {
  const run = await runs.createWorkerRun({ orgId, agentSlug: 'factory-worker', input: { task: { task_id: 'northwind-t12', objective: 'Add a PDF export.' } } });
  await runs.claimWorkerRun({ orgId, id: run.id, workerId: 'w1' });
  return run;
}

function events(from: number, to: number, over: Record<string, unknown> = {}) {
  return Array.from({ length: to - from + 1 }, (_, i) => ({ seq: from + i, ts: new Date(Date.UTC(2026, 8, 28, 10, 0, i)).toISOString(), phase: 'claude.tool', fields: { tool: 'Read', target: `src/f${from + i}.ts`, ok: true }, ...over }));
}

async function held(runId: number) {
  return db.select().from(workerRunEventSchema).where(eq(workerRunEventSchema.runId, runId)).orderBy(workerRunEventSchema.seq);
}

beforeEach(async () => {
  await db.delete(workerRunEventSchema);
  await db.delete(workerRunSchema);
  await db.delete(toolCallSchema);
  await db.delete(missionRunSchema);
});

describe('a heartbeat carries the run\'s step lines', () => {
  it('stores them and answers with the highest seq it holds', async () => {
    const run = await runningRun();
    const reply = await runs.heartbeatWorkerRun({ orgId: ORG, id: run.id, workerId: 'w1', progress: { phase: 'claude' }, events: events(1, 3) });

    expect(reply.eventsAccepted).toBe(3);
    expect((await held(run.id)).map(e => [e.seq, e.phase, e.orgId])).toEqual([[1, 'claude.tool', ORG], [2, 'claude.tool', ORG], [3, 'claude.tool', ORG]]);
  });

  it('is idempotent on seq: a retried beat stores nothing twice', async () => {
    const run = await runningRun();
    await svc.ingestRunEvents({ orgId: ORG, runId: run.id, events: events(1, 5) });
    const again = await svc.ingestRunEvents({ orgId: ORG, runId: run.id, events: events(3, 7) });

    expect(again).toEqual({ ok: true, accepted: 7, stored: 2, dropped: 0 });
    expect((await held(run.id)).map(e => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('takes at most 200 lines a beat, lowest seqs first, and acknowledges only those', async () => {
    const run = await runningRun();
    const r = await svc.ingestRunEvents({ orgId: ORG, runId: run.id, events: events(1, 250).reverse() });

    expect(r).toEqual({ ok: true, accepted: 200, stored: 200, dropped: 0 });
    expect((await held(run.id)).at(-1)!.seq).toBe(200);
  });

  it('stops storing at 5000 lines a run, and acknowledges the rest so the worker stops resending', async () => {
    const run = await runningRun();
    // Fill to the cap directly; 25 beats of 200 would say the same, slower.
    await db.insert(workerRunEventSchema).values(Array.from({ length: svc.EVENTS_PER_RUN - 1 }, (_, i) => ({ orgId: ORG, runId: run.id, seq: i + 1, ts: new Date(), phase: 'claude.tool', fields: {} })));
    const r = await svc.ingestRunEvents({ orgId: ORG, runId: run.id, events: events(svc.EVENTS_PER_RUN, svc.EVENTS_PER_RUN + 9) });

    expect(r).toEqual({ ok: true, accepted: svc.EVENTS_PER_RUN + 9, stored: 1, dropped: 9 });
    expect((await held(run.id)).length).toBe(svc.EVENTS_PER_RUN);
  });

  it('bounds a message to 2000 characters and fields to 8KB, keeping the end of a tail', async () => {
    const run = await runningRun();
    const tail = `${'x'.repeat(20_000)}THE END`;
    await svc.ingestRunEvents({ orgId: ORG, runId: run.id, events: [{ seq: 1, ts: '2026-09-28T10:00:00Z', phase: 'check', message: 'm'.repeat(5000), fields: { name: 'test', status: 'failed', tail } }] });
    const [row] = await held(run.id);

    expect(row!.message!.length).toBe(svc.MESSAGE_CHARS);
    expect(new TextEncoder().encode(JSON.stringify(row!.fields)).length).toBeLessThanOrEqual(svc.FIELDS_BYTES);
    expect(String(row!.fields.tail)).toMatch(/THE END$/);
    expect(row!.fields).toMatchObject({ name: 'test', status: 'failed', _truncated: true });
    // A failed check is stored as an error line, so "which runs failed where" reads a column.
    expect(row!.level).toBe('error');
  });

  it('skips a line with no seq or no phase rather than refusing the batch', async () => {
    const run = await runningRun();
    const r = await svc.ingestRunEvents({ orgId: ORG, runId: run.id, events: [{ seq: 0, phase: 'x' }, { seq: 2 }, 'nonsense', { seq: 3, phase: 'claim', ts: 'not a date' }] });

    expect(r).toMatchObject({ ok: true, accepted: 3, stored: 1 });
  });

  it('never writes to another workspace\'s run', async () => {
    const run = await runningRun(OTHER);
    const r = await svc.ingestRunEvents({ orgId: ORG, runId: run.id, events: events(1, 2) });

    expect(r).toEqual({ ok: false, reason: 'not_found' });
    expect(await held(run.id)).toHaveLength(0);
  });

  it('refuses lines for a run that has stopped, unless they are its final batch', async () => {
    const run = await runningRun();
    await runs.completeWorkerRun({ orgId: ORG, id: run.id, workerId: 'w1' });

    expect(await svc.ingestRunEvents({ orgId: ORG, runId: run.id, events: events(1, 1) })).toEqual({ ok: false, reason: 'not_running' });
    expect(await svc.ingestRunEvents({ orgId: ORG, runId: run.id, events: events(1, 1), final: true })).toMatchObject({ ok: true, stored: 1 });
  });

  it('a heartbeat whose lines cannot be stored still extends the lease', async () => {
    const run = await runningRun();
    const reply = await runs.heartbeatWorkerRun({ orgId: ORG, id: run.id, workerId: 'w1', events: ['nonsense'] });

    expect(reply.stop).toBe(false);
    expect(reply.eventsAccepted).toBe(0);
  });
});

describe('the final batch rides with complete and fail', () => {
  it('lands before the run closes, checked against the lease', async () => {
    const run = await runningRun();

    await expect(runs.recordFinalRunEvents({ orgId: ORG, id: run.id, workerId: 'someone-else', events: events(1, 1) })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await runs.recordFinalRunEvents({ orgId: ORG, id: run.id, workerId: 'w1', events: events(1, 4) })).toBe(4);

    await runs.failWorkerRun({ orgId: ORG, id: run.id, workerId: 'w1', error: 'checks red', result: { transcriptArtifactId: 91, logLinks: { stream: 'https://logs.example/7/stream' } } });

    // A retried fail sends the same lines again: nothing new, same answer.
    expect(await runs.recordFinalRunEvents({ orgId: ORG, id: run.id, workerId: 'w1', events: events(1, 4) })).toBe(4);
    expect(await held(run.id)).toHaveLength(4);
  });
});

describe('the run page reads the log after a cursor', () => {
  it('returns an engineering run\'s header and only the lines after `after`', async () => {
    const run = await runningRun();
    await svc.ingestRunEvents({ orgId: ORG, runId: run.id, events: events(1, 6) });

    const all = await svc.readRunLog(ORG, String(run.id));
    const since = await svc.readRunLog(ORG, String(run.id), 4);

    expect(all!.events.map(e => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(all!.cursor).toBe(6);
    expect(since!.events.map(e => e.seq)).toEqual([5, 6]);
    expect(since!.header).toMatchObject({ kind: 'worker', ref: String(run.id), title: 'northwind-t12', status: 'running', attempt: 1 });
    expect(await svc.readRunLog(OTHER, String(run.id))).toBeNull();
  });

  it('links a stopped run\'s transcript, prompt and full logs, and keeps its Claude Code block', async () => {
    const run = await runningRun();
    await runs.failWorkerRun({ orgId: ORG, id: run.id, workerId: 'w1', error: 'verification failed: test', result: { transcriptArtifactId: 91, promptArtifactId: '92', logLinks: { stream: 'https://logs.example/7/stream', stderr: 'javascript:alert(1)', checks: { test: 'https://logs.example/7/test' } } } });
    const data = await svc.readRunLog(ORG, String(run.id));

    expect(data!.header.links).toEqual([
      { label: 'Transcript', href: '/dashboard/artifacts/91', external: false },
      { label: 'Prompt', href: '/dashboard/artifacts/92', external: false },
    ]);
    expect(data!.header.logLinks).toEqual({ stream: 'https://logs.example/7/stream', stderr: null, checks: { test: 'https://logs.example/7/test' } });
    expect(data!.header.attach).toMatch(new RegExp(`^Vocion software factory run #${run.id} failed \\(northwind-t12\\)`));
  });

  it('returns an agent run\'s plan and its tool calls after the cursor', async () => {
    const [mission] = await db.insert(missionRunSchema).values({ orgId: ORG, title: 'contract-red-team: every criterion is proven', brief: 'Review PR #71.', status: 'running', team: { lead: 'change-reviewer', members: [] }, plan: { tasks: [{ id: 't1', title: 'Review the change', ownerAgentSlug: 'change-reviewer', type: 'analysis', status: 'running', startedAt: '2026-09-28T09:00:00.000Z' }] } }).returning();
    const [a] = await db.insert(toolCallSchema).values({ orgId: ORG, agentSlug: 'change-reviewer', tool: 'search_knowledge', input: { query: 'room export contract' }, durationMs: 700, missionRunId: mission!.id }).returning();
    await db.insert(toolCallSchema).values({ orgId: ORG, agentSlug: 'change-reviewer', tool: 'read_pr', input: { id: 71 }, error: 'timeout', missionRunId: mission!.id });
    await db.insert(toolCallSchema).values({ orgId: OTHER, agentSlug: 'x', tool: 'leak', missionRunId: mission!.id });

    const all = await svc.readRunLog(ORG, `agent-${mission!.id}`);
    const since = await svc.readRunLog(ORG, `agent-${mission!.id}`, a!.id);

    expect(all!.header).toMatchObject({ kind: 'agent', ref: `agent-${mission!.id}`, status: 'running' });
    expect(all!.calls.map(c => [c.tool, c.input, c.ok])).toEqual([['search_knowledge', 'room export contract', true], ['read_pr', '{"id":71}', false]]);
    expect(all!.tasks[0]).toMatchObject({ id: 't1', status: 'running', startedAt: '2026-09-28T09:00:00.000Z' });
    expect(since!.calls.map(c => c.tool)).toEqual(['read_pr']);
  });

  it('knows no run by a malformed id', async () => {
    expect(await svc.readRunLog(ORG, 'agent-')).toBeNull();
    expect(await svc.readRunLog(ORG, '12abc')).toBeNull();
  });
});

describe('the step log is kept for 30 days', () => {
  it('deletes older lines and leaves the run and its newer lines', async () => {
    const run = await runningRun();
    await svc.ingestRunEvents({ orgId: ORG, runId: run.id, events: events(1, 3) });
    await db.update(workerRunEventSchema).set({ createdAt: new Date('2026-08-01T00:00:00Z') }).where(eq(workerRunEventSchema.seq, 1));

    expect(await svc.pruneRunEvents(new Date('2026-09-28T00:00:00Z'))).toBe(1);
    expect((await held(run.id)).map(e => e.seq)).toEqual([2, 3]);
    expect(await runs.getWorkerRun(ORG, run.id)).not.toBeNull();
  });
});
