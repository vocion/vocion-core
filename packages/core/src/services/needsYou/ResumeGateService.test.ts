/**
 * The idle and stop gate, against a real (PGlite) database: a run whose
 * remaining work all waits on asks files ONE resume-gate ask and stops
 * spending; answering what it waits on — or the gate itself — resumes it; Stop
 * stops it; and nothing reaches across a workspace.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/FeedbackWorkerService', () => ({ enqueue: vi.fn(async () => ({ id: 1 })) }));
vi.mock('@/services/EventService', () => ({ ASK_DECIDED: 'ask.decided', emitEvent: vi.fn(async () => ({ eventId: 1, deduped: false, triggered: [], skipped: [] })) }));

const jobs = vi.hoisted(() => ({ started: [] as Array<{ id: string; call: { job: string; input: Record<string, unknown> } }>, fail: false }));
vi.mock('@/libs/durable/jobs', async importOriginal => ({
  ...(await importOriginal<typeof import('@/libs/durable/jobs')>()),
  startJob: vi.fn(async (id: string, call: { job: string; input: Record<string, unknown> }) => {
    if (jobs.fail) {
      throw new Error('the durable engine is away');
    }
    jobs.started.push({ id, call });
    return { id };
  }),
}));
const runtime = vi.hoisted(() => ({ executeMissionRun: vi.fn(async () => 'completed') }));
vi.mock('@/services/missions/runtime', () => runtime);

const { db } = await import('@/libs/DB');
const { askSchema, automationSchema, missionRunSchema, resumeGateSchema, workerRunSchema } = await import('@/models/Schema');
const { and, eq } = await import('drizzle-orm');
const asks = await import('@/services/AskService');
const gates = await import('./ResumeGateService');
const { parkWorkerRun, heartbeatWorkerRun } = await import('@/services/WorkerRunService');

const ORG = 'org_gate_a';
const OTHER = 'org_gate_b';

async function ask(orgId: string, title: string) {
  return (await asks.upsertAsk({ orgId, ask: { kind: 'ruling', title, options: [{ id: 'a', label: 'Option A', recommended: true }, { id: 'b', label: 'Option B' }] } })).ask;
}

async function workerRun(orgId: string) {
  const [row] = await db.insert(workerRunSchema).values({ orgId, agentSlug: 'migrator', status: 'running', workerId: 'w-1', leaseExpiresAt: new Date(Date.now() + 300_000), cursor: 'step-3' }).returning();
  return row!;
}

async function runOf(id: number) {
  return (await db.select().from(workerRunSchema).where(eq(workerRunSchema.id, id)))[0]!;
}

async function askOf(id: number) {
  return (await db.select().from(askSchema).where(eq(askSchema.id, id)))[0]!;
}

beforeEach(async () => {
  vi.clearAllMocks();
  jobs.started.length = 0;
  jobs.fail = false;
  await db.delete(resumeGateSchema);
  await db.delete(askSchema);
  await db.delete(workerRunSchema);
  await db.delete(missionRunSchema);
  await db.delete(automationSchema);
});

describe('parking a worker run', () => {
  it('files ONE gate ask, pauses the run and gives up its lease — the worker can exit, nothing is reaped', async () => {
    const q1 = await ask(ORG, 'Which pricing tier for Northwind?');
    const q2 = await ask(ORG, 'Is the Q4 budget approved?');
    const run = await workerRun(ORG);

    const parked = await parkWorkerRun({ orgId: ORG, id: run.id, workerId: 'w-1', waitingOn: [q1.id, q2.id], reason: 'the pricing tier and the Q4 budget', cursor: 'step-4' });

    expect(parked.created).toBe(true);
    expect(parked.run).toMatchObject({ status: 'paused', leaseExpiresAt: null, cursor: 'step-4' });

    const gate = await askOf(parked.gateAskId);

    expect(gate).toMatchObject({ kind: 'gate', status: 'open', title: 'Nothing migrator can do until the pricing tier and the Q4 budget' });
    expect(gate.options.map(o => o.id)).toEqual(['resume', 'stop']);
    // A gate is never answered by default: nothing is recommended on it.
    expect(gate.options.some(o => o.recommended)).toBe(false);
    expect(gate.body).toMatch(/stopped spending — no model calls/);

    // A heartbeat while it waits is told it is paused and never holds a lease again.
    const beat = await heartbeatWorkerRun({ orgId: ORG, id: run.id, workerId: 'w-1' });

    expect(beat.paused).toBe(true);
    expect((await runOf(run.id)).leaseExpiresAt).toBeNull();
  });

  it('joins the gate already standing when it parks again', async () => {
    const q1 = await ask(ORG, 'First question');
    const q2 = await ask(ORG, 'Second question');
    const run = await workerRun(ORG);

    const first = await parkWorkerRun({ orgId: ORG, id: run.id, workerId: 'w-1', waitingOn: [q1.id] });
    const second = await parkWorkerRun({ orgId: ORG, id: run.id, workerId: 'w-1', waitingOn: [q2.id] });

    expect(second.created).toBe(false);
    expect(second.gateAskId).toBe(first.gateAskId);
    expect(second.waitingOn.sort()).toEqual([q1.id, q2.id].sort());
    expect(await db.select().from(askSchema).where(eq(askSchema.kind, 'gate'))).toHaveLength(1);
  });

  it('refuses when nothing named is still open, when an ask is another workspace\'s, and when the lease is someone else\'s', async () => {
    const answered = await ask(ORG, 'Already answered');
    await asks.decideAsk({ orgId: ORG, id: answered.id, decision: 'a', decidedBy: 'usr-ada' });
    const theirs = await ask(OTHER, 'Their question');
    const run = await workerRun(ORG);

    await expect(parkWorkerRun({ orgId: ORG, id: run.id, workerId: 'w-1', waitingOn: [answered.id] })).rejects.toMatchObject({ status: 409 });
    await expect(parkWorkerRun({ orgId: ORG, id: run.id, workerId: 'w-1', waitingOn: [theirs.id] })).rejects.toMatchObject({ status: 404 });
    await expect(parkWorkerRun({ orgId: ORG, id: run.id, workerId: 'w-2', waitingOn: [theirs.id] })).rejects.toMatchObject({ status: 403 });
    await expect(gates.parkOnAsks({ orgId: OTHER, subject: { kind: 'worker_run', id: run.id }, waitingOn: [theirs.id] })).rejects.toMatchObject({ status: 404 });
    expect((await runOf(run.id)).status).toBe('running');
  });
});

describe('answering resumes it', () => {
  it('queues the run again, on its own, once every question it waited on is answered', async () => {
    const q1 = await ask(ORG, 'First');
    const q2 = await ask(ORG, 'Second');
    const run = await workerRun(ORG);
    const { gateAskId } = await parkWorkerRun({ orgId: ORG, id: run.id, workerId: 'w-1', waitingOn: [q1.id, q2.id] });

    await asks.decideAsk({ orgId: ORG, id: q1.id, decision: 'a', decidedBy: 'usr-ada' });

    expect((await runOf(run.id)).status).toBe('paused');

    await asks.decideAsk({ orgId: ORG, id: q2.id, decision: 'b', decidedBy: 'usr-ada' });

    expect((await runOf(run.id)).status).toBe('queued');
    expect(await askOf(gateAskId)).toMatchObject({ status: 'superseded', decisionNote: 'All 2 questions it waited on were answered.' });

    const [gate] = await db.select().from(resumeGateSchema);

    expect(gate).toMatchObject({ status: 'resumed', resolvedBy: 'answers' });
  });

  it('a withdrawn question counts as settled', async () => {
    const q = await ask(ORG, 'Only question');
    const run = await workerRun(ORG);
    await parkWorkerRun({ orgId: ORG, id: run.id, workerId: 'w-1', waitingOn: [q.id] });

    await asks.supersedeAsk(ORG, q.id, 'the thing it asked about went away');

    expect((await runOf(run.id)).status).toBe('queued');
  });

  it('Resume on the gate resumes it as things stand; Stop cancels it', async () => {
    const q = await ask(ORG, 'Still open');
    const r = await ask(ORG, 'Also open');
    const a = await workerRun(ORG);
    const b = await workerRun(ORG);
    const gateA = await parkWorkerRun({ orgId: ORG, id: a.id, workerId: 'w-1', waitingOn: [q.id] });
    const gateB = await parkWorkerRun({ orgId: ORG, id: b.id, workerId: 'w-1', waitingOn: [r.id] });

    await asks.decideAsk({ orgId: ORG, id: gateA.gateAskId, decision: 'resume', decidedBy: 'usr-ada' });
    await asks.decideAsk({ orgId: ORG, id: gateB.gateAskId, decision: 'stop', decidedBy: 'usr-ada' });

    expect((await runOf(a.id)).status).toBe('queued');
    expect(await runOf(b.id)).toMatchObject({ status: 'cancelled', error: 'stopped while it waited on answers' });
    expect((await askOf(q.id)).status).toBe('open');
  });

  it('two runs waiting on the same thing are one question for a person, and one answer moves both', async () => {
    const q = await ask(ORG, 'Shared question');
    const a = await workerRun(ORG);
    const b = await workerRun(ORG);
    const gateA = await parkWorkerRun({ orgId: ORG, id: a.id, workerId: 'w-1', waitingOn: [q.id] });
    const gateB = await parkWorkerRun({ orgId: ORG, id: b.id, workerId: 'w-1', waitingOn: [q.id] });

    expect(gateB.gateAskId).toBe(gateA.gateAskId);

    await asks.decideAsk({ orgId: ORG, id: gateA.gateAskId, decision: 'resume', decidedBy: 'usr-ada' });

    expect((await runOf(a.id)).status).toBe('queued');
    expect((await runOf(b.id)).status).toBe('queued');
  });

  it('an answer in one workspace never resumes a run in another', async () => {
    const mine = await ask(ORG, 'Mine');
    const run = await workerRun(ORG);
    await parkWorkerRun({ orgId: ORG, id: run.id, workerId: 'w-1', waitingOn: [mine.id] });
    // A gate row in the other workspace that names the same ask id must not move either.
    await db.insert(resumeGateSchema).values({ orgId: OTHER, subjectKind: 'automation', subjectRef: 'nightly', automationSlug: 'nightly', waitingOn: [mine.id] });

    await asks.decideAsk({ orgId: ORG, id: mine.id, decision: 'a', decidedBy: 'usr-ada' });

    const other = await db.select().from(resumeGateSchema).where(eq(resumeGateSchema.orgId, OTHER));

    expect(other[0]!.status).toBe('parked');
    expect((await runOf(run.id)).status).toBe('queued');
  });
});

describe('mission runs and automations', () => {
  async function missionRun(orgId: string) {
    const [row] = await db.insert(missionRunSchema).values({ orgId, title: 'Weekly pipeline', brief: 'Check the pipeline', status: 'running', team: { lead: 'revenue-lead', members: [] }, plan: { tasks: [{ id: 't1', title: 'Look', ownerAgentSlug: 'revenue-lead', type: 'analysis', status: 'running' }, { id: 't2', title: 'Act', ownerAgentSlug: 'revenue-lead', type: 'analysis', status: 'pending' }] } }).returning();
    return row!;
  }

  it('pauses a mission run before its next task, and resumes it on a durable job that claims it once', async () => {
    const q = await ask(ORG, 'Which deals to chase?');
    const run = await missionRun(ORG);

    const parked = await gates.parkOnAsks({ orgId: ORG, subject: { kind: 'mission_run', id: run.id }, waitingOn: [q.id], agentSlug: 'revenue-lead' });

    expect(await gates.missionRunParked(ORG, run.id)).toBe(true);
    expect(await gates.missionRunParked(OTHER, run.id)).toBe(false);
    expect((await gates.parkedRunIds(ORG)).mission.has(run.id)).toBe(true);

    await asks.decideAsk({ orgId: ORG, id: q.id, decision: 'a', decidedBy: 'usr-ada' });

    expect(jobs.started).toEqual([{ id: `resume-gate-${parked.gate.id}`, call: { job: 'mission-run.resume', input: { orgId: ORG, runId: run.id, gateId: parked.gate.id } } }]);

    const first = await gates.resumeParkedMissionRun({ orgId: ORG, runId: run.id, gateId: parked.gate.id });
    const again = await gates.resumeParkedMissionRun({ orgId: ORG, runId: run.id, gateId: parked.gate.id });

    expect(first).toEqual({ resumed: true, status: 'completed' });
    expect(again).toEqual({ resumed: false });
    expect(runtime.executeMissionRun).toHaveBeenCalledTimes(1);
  });

  it('holds an automation\'s schedule until answered, then fires it once straight away', async () => {
    await db.insert(automationSchema).values({ orgId: ORG, slug: 'pipeline-check', name: 'Pipeline check', whenConfig: { schedule: '0 13 * * 1' }, doConfig: { checkMission: 'pipeline' } });
    const q = await ask(ORG, 'Chase Acme or not?');

    const parked = await gates.parkOnAsks({ orgId: ORG, subject: { kind: 'automation', slug: 'pipeline-check' }, waitingOn: [q.id] });

    expect((await gates.automationHold(ORG, 'pipeline-check'))?.id).toBe(parked.gate.id);
    expect(await gates.automationHold(OTHER, 'pipeline-check')).toBeNull();
    expect((await askOf(parked.gateAskId)).body).toMatch(/no scheduled checks/);

    await asks.decideAsk({ orgId: ORG, id: q.id, decision: 'a', decidedBy: 'usr-ada' });

    expect(await gates.automationHold(ORG, 'pipeline-check')).toBeNull();
    expect(jobs.started[0]?.call).toEqual({ job: 'automation.fire', input: { orgId: ORG, slug: 'pipeline-check', invokedBy: `resume-gate:${parked.gate.id}` } });
  });

  it('Stop on an automation\'s gate pauses the automation as the person\'s act', async () => {
    await db.insert(automationSchema).values({ orgId: ORG, slug: 'pipeline-check', name: 'Pipeline check', whenConfig: { event: 'deal.updated' }, doConfig: { checkMission: 'pipeline' } });
    const q = await ask(ORG, 'Chase Acme or not?');
    const parked = await gates.parkOnAsks({ orgId: ORG, subject: { kind: 'automation', slug: 'pipeline-check' }, waitingOn: [q.id] });

    await asks.decideAsk({ orgId: ORG, id: parked.gateAskId, decision: 'stop', decidedBy: 'usr-ada', note: 'Not this quarter.' });

    const [auto] = await db.select().from(automationSchema).where(and(eq(automationSchema.orgId, ORG), eq(automationSchema.slug, 'pipeline-check')));

    expect(auto).toMatchObject({ pausedBy: 'usr-ada', pausedNote: 'Not this quarter.' });
    expect((await db.select().from(resumeGateSchema))[0]).toMatchObject({ status: 'stopped' });
  });
});

describe('healing', () => {
  it('a resume that failed says why on the gate, and the sweep resumes it once it can', async () => {
    const q = await ask(ORG, 'Which deals?');
    const [run] = await db.insert(missionRunSchema).values({ orgId: ORG, title: 'Run', brief: 'b', status: 'running', team: { lead: 'x', members: [] }, plan: { tasks: [{ id: 't2', title: 'Act', ownerAgentSlug: 'x', type: 'analysis', status: 'pending' }] } }).returning();
    await gates.parkOnAsks({ orgId: ORG, subject: { kind: 'mission_run', id: run!.id }, waitingOn: [q.id] });
    jobs.fail = true;

    await asks.decideAsk({ orgId: ORG, id: q.id, decision: 'a', decidedBy: 'usr-ada' });

    const [stuck] = await db.select().from(resumeGateSchema);

    expect(stuck).toMatchObject({ status: 'parked', lastError: expect.stringMatching(/the durable engine is away/) });

    jobs.fail = false;
    const healed = await gates.healParkedGates({ orgId: ORG });

    expect(healed.resumed).toBe(1);
    expect((await db.select().from(resumeGateSchema))[0]).toMatchObject({ status: 'resumed', lastError: null });
  });

  it('heals only the workspace it is asked about', async () => {
    const q = await ask(OTHER, 'Theirs');
    await db.insert(resumeGateSchema).values({ orgId: OTHER, subjectKind: 'automation', subjectRef: 'x', automationSlug: 'x', waitingOn: [q.id] });
    await db.update(askSchema).set({ status: 'done' }).where(eq(askSchema.id, q.id));

    expect((await gates.healParkedGates({ orgId: ORG })).resumed).toBe(0);
    expect((await db.select().from(resumeGateSchema))[0]!.status).toBe('parked');
  });
});
