/**
 * The factory carrying a request through (backlog 038), against PGlite.
 *
 * Filing a fix in chat starts its build; a contract the plan rule gates plans
 * instead of building; the plan's approval on the trust bar dispatches the
 * build with the plan; a failed run recovers within the limit or stops with
 * one ask; the sweep carries on a request that was already stuck. Every name,
 * repo and path is invented.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, agentSchema, askSchema, automationSchema, businessObjectSchema, eventLogSchema, trustRuleSchema, workerRunSchema } = await import('@/models/Schema');
const { createObjectType, getObjectTypeBySlug } = await import('@/services/BusinessObjectService');
const { and, eq } = await import('drizzle-orm');
const carry = await import('./carry');
const { createWorkerRun, claimWorkerRun, failWorkerRun } = await import('@/services/WorkerRunService');

const ORG = 'org_factory_carry';
const types: Record<string, number> = {};
const previous = process.env.VOCION_EXTERNAL_WORKERS;

beforeAll(async () => {
  process.env.VOCION_EXTERNAL_WORKERS = '1';
  for (const slug of ['request', 'engineering_task', 'architecture_plan', 'repo']) {
    const [t] = await createObjectType({ slug, label: slug }, ORG);
    types[slug] = t!.id;
  }
  await db.insert(agentSchema).values({ orgId: ORG, slug: 'task-engineer', name: 'Engineer', systemPrompt: 'x', harnessConfig: { runsOn: 'external-worker' } } as never);
  await db.insert(businessObjectSchema).values({
    orgId: ORG,
    typeId: types.repo!,
    title: 'Acme/northwind-core',
    metadata: {
      checks: [{ name: 'test' }, { name: 'lint' }],
      productPaths: { rooms: ['apps/web/src/**'], fleet: ['apps/web/src/**', 'packages/core/src/**'] },
    },
  });
  for (const actionId of ['factory.dispatch_task.from_request', 'factory.dispatch_task.recovery', 'factory.dispatch_task.from_plan']) {
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId, threshold: 0.8, enabled: 'true' });
  }
  await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: 'factory.approve_plan', threshold: 0.85, enabled: 'true' });
  await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: 'factory.dispatch_task', threshold: 1, enabled: 'false' });
  // The plugin's wiring, as the workspace applies it: a plan's approval builds.
  await db.insert(automationSchema).values({ orgId: ORG, slug: 'factory-plan-approved', name: 'A plan was approved', status: 'active', whenConfig: { event: 'plan.approved' }, doConfig: { job: 'factory-plan-build' }, ownerAgentSlug: 'product-manager' });
});

afterAll(() => {
  process.env.VOCION_EXTERNAL_WORKERS = previous;
});

async function request(meta: Record<string, unknown>) {
  const [row] = await db.insert(businessObjectSchema).values({
    orgId: ORG,
    typeId: types.request!,
    title: String(meta.title ?? 'A member cannot open a room they were invited to'),
    metadata: { kind: 'bug', severity: 'p1', state: 'new', outcome: 'An invited member opens the room.', acceptance: ['An invited member opens the room from the email link.'], ownerRepo: 'Acme/northwind-core', ...meta },
  }).returning();
  return row!;
}

async function read(id: number) {
  const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, id));
  return row!;
}

async function runsFor(requestId: number) {
  const tasks = (await db.select().from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, ORG), eq(businessObjectSchema.typeId, types.engineering_task!))))
    .filter(t => Number((t.metadata as Record<string, unknown>).requestId) === requestId);
  const runs = await db.select().from(workerRunSchema).where(eq(workerRunSchema.orgId, ORG));
  return runs.filter(r => tasks.some(t => Number(((r.input as Record<string, unknown>).record as { id?: number } | undefined)?.id) === t.id)).sort((a, b) => a.id - b.id);
}

/**
 * A worker takes the newest run for a request and fails it the way the worker does.
 * @param requestId
 * @param error
 * @param failures
 */
async function failNewest(requestId: number, error: string, failures: Array<{ scope: string; message: string }> = []) {
  const run = (await runsFor(requestId)).at(-1)!;
  await claimWorkerRun({ orgId: ORG, id: run.id, workerId: 'w-1' });
  await failWorkerRun({ orgId: ORG, id: run.id, workerId: 'w-1', error, failures });
  return run.id;
}

describe('filing starts the work', () => {
  it('starts the build of a fix a person asked for in chat, done for you, in the same call', async () => {
    const r = await request({ product: 'rooms' });

    const out = await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r.id, conversationId: 12, byPerson: true });

    expect(out.did).toBe('start:done');

    const runs = await runsFor(r.id);

    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('queued');
    expect((runs[0]!.input as { task: Record<string, unknown> }).task).toMatchObject({ allowed_paths: ['apps/web/src/**', 'apps/web/tests/**'], required_checks: ['test', 'lint'] });

    const meta = (await read(r.id)).metadata as Record<string, unknown>;

    expect(meta.state).toBe('building');
    expect((meta.recovery as { attempts: Array<{ trigger: string }> }).attempts.map(a => a.trigger)).toEqual(['request']);

    const [dispatch] = await db.select().from(actionRunSchema).where(and(eq(actionRunSchema.orgId, ORG), eq(actionRunSchema.actionId, 'factory.dispatch_task')));

    expect(dispatch?.approvedByAgent).toBe(true);
  });

  it('files the Build card for a request nobody asked for in a conversation', async () => {
    const r = await request({ product: 'rooms', title: 'Rename the share button' });

    const out = await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r.id, conversationId: null, byPerson: true });

    expect(out.did).toBe('card:pending');
    expect(await runsFor(r.id)).toHaveLength(0);
    expect(((await read(r.id)).metadata as Record<string, unknown>).recommendationState).toBe('proposed');
  });
});

describe('build is one path through the plan gate', () => {
  it('plans instead of dispatching a contract the rule would refuse, and the approved plan builds itself', async () => {
    const r = await request({ product: 'fleet', title: 'Show the fleet status on the room page' });

    await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r.id, conversationId: 12, byPerson: true });

    expect(await runsFor(r.id)).toHaveLength(0);

    const planning = (await read(r.id)).metadata as { recovery: { stage: string; line: string } };

    expect(planning.recovery.stage).toBe('planning');
    expect(planning.recovery.line).toMatch(/^Planning — the allowed paths span 2 packages \(apps\/web, packages\/core\)/);

    const asked = await db.select().from(eventLogSchema).where(and(eq(eventLogSchema.orgId, ORG), eq(eventLogSchema.type, 'factory.plan_requested')));

    expect(asked.map(e => (e.payload as { requestId: number }).requestId)).toContain(r.id);

    // The planner files the plan (here, by hand); its approval is on the trust bar.
    const [plan] = await db.insert(businessObjectSchema).values({
      orgId: ORG,
      typeId: types.architecture_plan!,
      title: 'Fleet status on the room page',
      status: 'approved',
      metadata: {
        requestId: r.id,
        status: 'in_review',
        approach: 'Read the fleet status in the core package and render it on the room page, so the page never computes it.',
        components: ['apps/web — the room page renders the status', 'packages/core — the status read'],
        alternatives: ['Compute it in the page: duplicates the rule.'],
        verification: 'The room page shows the status; a test covers the read.',
        dataImpact: 'None.',
        ruleLevel: 'required',
        ruleTriggers: ['the allowed paths span 2 packages (apps/web, packages/core), so an architectural boundary is being crossed'],
      },
    }).returning();

    const reviewed = await carry.reviewFiledPlan(ORG, { objectType: 'architecture_plan', objectId: plan!.id });

    expect(reviewed.did).toBe('approve_plan:done');
    expect(((await read(plan!.id)).metadata as Record<string, unknown>).status).toBe('approved');

    const runs = await runsFor(r.id);

    expect(runs).toHaveLength(1);

    const task = (runs[0]!.input as { task: Record<string, unknown> }).task;

    expect(task.allowed_paths).toEqual(expect.arrayContaining(['apps/web/**', 'packages/core/**']));
    expect(task.plan).toMatchObject({ plan_id: String(plan!.id) });
  });
});

describe('a failed run recovers', () => {
  it('sends failed checks again with their output, and stops after three attempts with one ask', async () => {
    const r = await request({ product: 'rooms', title: 'The invite email links to the wrong room' });
    await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r.id, conversationId: 12, byPerson: true });

    const first = await failNewest(r.id, 'verification failed: required checks failed: test', [{ scope: 'check:test', message: 'expected room 7, got room 6' }]);
    const recovered = await carry.recoverFailedRun(ORG, first);

    expect(recovered).toMatchObject({ did: 'dispatch', line: 'Recovered: sending it again because the required checks failed (test).' });

    const second = (await runsFor(r.id)).at(-1)!;

    expect((second.input as { task: { objective: string } }).task.objective).toContain('test: expected room 7, got room 6');
    expect(((await read(r.id)).metadata as { recovery: { stage: string; line: string } }).recovery).toMatchObject({ stage: 'recovering', line: expect.stringMatching(/^Recovering \(attempt 2 of 3\)/) });

    const [firstRun] = await db.select().from(workerRunSchema).where(eq(workerRunSchema.id, first));

    expect((firstRun!.result as { recovery?: { line: string } }).recovery?.line).toBe('Recovered: sending it again because the required checks failed (test).');
    // The event and the sweep never act twice on one run.
    expect((await carry.recoverFailedRun(ORG, first)).did).toBe('already handled');

    await carry.recoverFailedRun(ORG, await failNewest(r.id, 'verification failed: required checks failed: test', [{ scope: 'check:test', message: 'still room 6' }]));
    const stopped = await carry.recoverFailedRun(ORG, await failNewest(r.id, 'verification failed: required checks failed: test', [{ scope: 'check:test', message: 'still room 6' }]));

    expect(stopped.did).toBe('escalate');
    expect(await runsFor(r.id)).toHaveLength(3);

    const meta = (await read(r.id)).metadata as { recovery: { stage: string; askId: number; line: string } };

    expect(meta.recovery.stage).toBe('stopped');
    expect(meta.recovery.line).toMatch(/^Stopped after 3 attempts: the required checks failed \(test\)\. What would unblock it: /);

    const [ask] = await db.select().from(askSchema).where(eq(askSchema.id, meta.recovery.askId));

    expect(ask).toMatchObject({ status: 'open', kind: 'approval', sourceRef: expect.stringMatching(new RegExp(`^factory-recovery:${r.id}:`)) });
    expect(ask!.body).toContain('3. Build (run #');
  });

  it('plans first when the worker refused for want of a plan', async () => {
    const r = await request({ product: 'rooms', title: 'Rooms remember their last layout' });
    await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r.id, conversationId: 12, byPerson: true });

    const runId = await failNewest(r.id, 'contract refused. … Nothing was cloned and no model was called.', [{ scope: 'contract', message: 'plan is required: risk_class is schema, which is irreversible, trust bearing or an externally visible promise. Write the plan, have it approved in Review.' }]);
    const out = await carry.recoverFailedRun(ORG, runId);

    expect(out).toMatchObject({ did: 'plan', line: expect.stringMatching(/^Recovered: planning first because the risk class is schema/) });
    expect(await runsFor(r.id)).toHaveLength(1);
    expect(((await read(r.id)).metadata as { recovery: { stage: string } }).recovery.stage).toBe('planning');
  });

  it('asks rather than repeat a no-changes attempt whose contract has not changed', async () => {
    const r = await request({ product: 'rooms', title: 'Rooms keep their order' });
    await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r.id, conversationId: 12, byPerson: true });

    const out = await carry.recoverFailedRun(ORG, await failNewest(r.id, 'verification failed: Claude produced no changes in the working tree (checks on the base: test=passed)'));

    expect(out.did).toBe('escalate');
    expect(out.line).toMatch(/records still give the same contract/);
    expect(await runsFor(r.id)).toHaveLength(1);
  });
});

describe('a request already stuck', () => {
  it('is carried on by the sweep, with nobody pressing Build', async () => {
    const r = await request({ product: 'rooms', title: 'Room names wrap on a phone', state: 'building' });
    // Stuck the old way: a task and a run that failed before any of this existed.
    const [task] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.engineering_task!, title: 'Room names wrap', status: 'dispatched', metadata: { requestId: r.id, status: 'dispatched' } }).returning();
    const run = await createWorkerRun({ orgId: ORG, agentSlug: 'task-engineer', input: { task: { allowed_paths: ['apps/web/src/**'] }, record: { id: task!.id, type: 'engineering_task' } } });
    await claimWorkerRun({ orgId: ORG, id: run.id, workerId: 'w-1' });
    await failWorkerRun({ orgId: ORG, id: run.id, workerId: 'w-1', error: 'prepare failed: git clone failed (128): Could not resolve host: github.example', failures: [{ scope: 'git', message: 'clone' }] });

    const { acted } = await carry.sweepStuckRequests(ORG);

    expect(acted.find(a => a.requestId === r.id)).toMatchObject({ did: 'dispatch' });
    expect(await runsFor(r.id)).toHaveLength(2);
    // A second sweep finds nothing to do on it.
    expect((await carry.sweepStuckRequests(ORG)).acted.find(a => a.requestId === r.id)).toBeUndefined();
  });

  it('leaves a run that failed weeks ago alone: that work was left, not stuck', async () => {
    const r = await request({ product: 'rooms', title: 'An old idea nobody came back to', state: 'building' });
    const [task] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.engineering_task!, title: 'Old idea', status: 'dispatched', metadata: { requestId: r.id, status: 'dispatched' } }).returning();
    const run = await createWorkerRun({ orgId: ORG, agentSlug: 'task-engineer', input: { task: {}, record: { id: task!.id, type: 'engineering_task' } } });
    await claimWorkerRun({ orgId: ORG, id: run.id, workerId: 'w-1' });
    await failWorkerRun({ orgId: ORG, id: run.id, workerId: 'w-1', error: 'prepare failed: git clone failed: Could not resolve host: github.example' });
    await db.update(workerRunSchema).set({ updatedAt: new Date(Date.now() - 30 * 86_400_000) }).where(eq(workerRunSchema.id, run.id));

    expect((await carry.sweepStuckRequests(ORG)).acted.find(a => a.requestId === r.id)).toBeUndefined();
    expect(await runsFor(r.id)).toHaveLength(1);
  });
});

describe('the live gaps (backlog 038, the first sweep)', () => {
  it('stops at once on the worker\'s environment, spending no attempt, and sends it again once the worker has changed', async () => {
    const r = await request({ product: 'rooms', title: 'Uploads survive a reload' });
    await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r.id, conversationId: 12, byPerson: true });
    const first = (await runsFor(r.id)).at(-1)!;
    await claimWorkerRun({ orgId: ORG, id: first.id, workerId: 'w-1', workerVersion: 'img-6bab52e' });
    await failWorkerRun({ orgId: ORG, id: first.id, workerId: 'w-1', error: 'services failed: prisma:sync failed: ', failures: [{ scope: 'services', message: 'prisma:sync failed: ' }] });

    const stopped = await carry.recoverFailedRun(ORG, first.id);

    expect(stopped.did).toBe('escalate');
    expect(stopped.line).toMatch(/^Stopped: the worker's environment is failing before any work starts: services failed: prisma:sync failed; it needs a person or a worker rebuild\. What would unblock it: /);
    expect(await runsFor(r.id)).toHaveLength(1);
    expect(((await read(r.id)).metadata as { recovery: { attempts: unknown[] } }).recovery.attempts).toHaveLength(1);
  });

  it('retries an environment failure when a newer worker has reported since', async () => {
    const r = await request({ product: 'rooms', title: 'Downloads keep their names' });
    await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r.id, conversationId: 12, byPerson: true });
    const first = (await runsFor(r.id)).at(-1)!;
    await claimWorkerRun({ orgId: ORG, id: first.id, workerId: 'w-1', workerVersion: 'img-old' });
    await failWorkerRun({ orgId: ORG, id: first.id, workerId: 'w-1', error: 'services failed: prisma:sync failed: ', failures: [{ scope: 'services', message: 'x' }] });
    // A rebuilt worker takes some other run afterwards and says what it is.
    const other = await createWorkerRun({ orgId: ORG, agentSlug: 'task-engineer', input: {} });
    await claimWorkerRun({ orgId: ORG, id: other.id, workerId: 'w-2', workerVersion: 'img-new' });

    const out = await carry.recoverFailedRun(ORG, first.id);

    expect(out).toMatchObject({ did: 'dispatch', line: expect.stringContaining('worker img-old → img-new') });
    expect(await runsFor(r.id)).toHaveLength(2);
  });

  it('counts a planning run that ended without a plan as a failed step, and plans again', async () => {
    const r = await request({ product: 'fleet', title: 'Fleet counts on the room list' });
    await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r.id, conversationId: 12, byPerson: true });
    const before = ((await read(r.id)).metadata as { recovery: { stage: string; attempts: unknown[] } }).recovery;

    expect(before.stage).toBe('planning');

    // Nothing in this workspace picks up the request for a plan, so the step has ended with none.
    const { acted } = await carry.sweepStuckRequests(ORG);

    expect(acted.find(a => a.requestId === r.id)).toMatchObject({ did: 'plan', line: expect.stringMatching(/^Recovered: planning again because nothing picked up the request for a plan/) });

    const after = ((await read(r.id)).metadata as { recovery: { stage: string; attempts: Array<{ kind: string; failure: { class: string } | null }> } }).recovery;

    expect(after.stage).toBe('planning');
    expect(after.attempts.filter(a => a.kind === 'plan').map(a => a.failure?.class ?? null)).toEqual(['no_plan', null]);
  });
});

describe('a rebuilt worker answers an infrastructure stop (ask #220, 2026-09-28)', () => {
  /**
   * A request whose first build failed on the worker's services, stopped with one ask.
   * @param title - The request's title.
   */
  async function stoppedOnTheWorker(title: string) {
    const r = await request({ product: 'rooms', title });
    await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r.id, conversationId: 12, byPerson: true });
    const first = (await runsFor(r.id)).at(-1)!;
    await claimWorkerRun({ orgId: ORG, id: first.id, workerId: 'w-1', workerVersion: 'img-before' });
    await failWorkerRun({ orgId: ORG, id: first.id, workerId: 'w-1', error: 'services failed: prisma:sync failed: ', failures: [{ scope: 'services', message: 'prisma:sync failed: ' }] });

    expect((await carry.recoverFailedRun(ORG, first.id)).did).toBe('escalate');

    const askId = ((await read(r.id)).metadata as { recovery: { askId: number } }).recovery.askId;
    const [ask] = await db.select().from(askSchema).where(eq(askSchema.id, askId));
    return { r, ask: ask! };
  }

  it('the stop\'s Approve names what it does, and approving it dispatches the build', async () => {
    const { r, ask } = await stoppedOnTheWorker('Alerts arrive by email');

    expect(ask.options[0]).toMatchObject({ id: 'approve', label: 'Build again on the current worker image', description: expect.stringContaining(`Starts a new build of request #${r.id} on whichever worker image is deployed when you approve`) });
    expect(ask.options[1]).toMatchObject({ id: 'reject', label: 'Leave it stopped' });
    expect(ask.body).toContain('A rebuilt worker resolves this on its own.');

    const out = await carry.answerRecoveryAsk(ORG, { askId: ask.id, sourceRef: ask.sourceRef, status: 'approved', decision: 'approve', decidedBy: 'usr-dana' });

    expect(out.did).toBe('build again');
    expect(await runsFor(r.id)).toHaveLength(2);
  });

  it('resolves itself when the worker\'s environment is redeployed after the stop, and builds once', async () => {
    const { r, ask } = await stoppedOnTheWorker('Alerts show in the app');

    // Nothing has changed yet: the stop stays with a person.
    expect((await carry.resumeAfterWorkerRebuild(ORG)).find(a => a.requestId === r.id)).toBeUndefined();

    // The deploy's record-environment step moves the worker environment's last deploy.
    const [envType] = await createObjectType({ slug: 'environment', label: 'Environment' }, ORG);
    await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: envType!.id, title: 'Northwind factory worker (production)', metadata: { slug: 'northwind-worker-production', surface: 'worker', stage: 'production', lastDeployedAt: new Date(Date.now() + 1000).toISOString(), lastDeployedSha: '3c9e1a7b55d0e4f1a2b3c4d5e6f708192a3b4c5d' } });

    const { acted } = await carry.sweepStuckRequests(ORG);

    expect(acted.find(a => a.requestId === r.id)).toMatchObject({ did: 'rebuilt:done', line: 'Worker rebuilt (northwind-worker-production 3c9e1a7b); building again.' });

    const [after] = await db.select().from(askSchema).where(eq(askSchema.id, ask.id));

    expect(after).toMatchObject({ status: 'superseded', decisionNote: 'Worker rebuilt (northwind-worker-production 3c9e1a7b); building again.' });

    const runs = await runsFor(r.id);

    expect(runs).toHaveLength(2);
    expect(runs[1]!.status).toBe('queued');

    const meta = (await read(r.id)).metadata as { workerRebuildResumedFor: string; recovery: { stage: string | null; askId: number | null; log: Array<{ text: string }> } };

    expect(meta.workerRebuildResumedFor).toBe('northwind-worker-production 3c9e1a7b');
    expect(meta.recovery.askId).toBeNull();
    expect(meta.recovery.log.at(-1)?.text).toBe(`Worker rebuilt (northwind-worker-production 3c9e1a7b); building again. Ask #${ask.id} resolved itself.`);

    // Once: a second sweep starts nothing more.
    await carry.sweepStuckRequests(ORG);

    expect(await runsFor(r.id)).toHaveLength(2);
  });

  it('stop → approve → new failure files a second, open ask — never reopening the first (prod, 2026-09-29: ask #220)', async () => {
    const { r, ask } = await stoppedOnTheWorker('Open alerts');

    // The worker is rebuilt: the first stop resolves itself and the build runs again.
    const envType = (await getObjectTypeBySlug(ORG, 'environment')) ?? (await createObjectType({ slug: 'environment', label: 'Environment' }, ORG))[0];
    await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: envType!.id, title: 'Northwind factory worker (production)', metadata: { slug: 'northwind-worker-production', surface: 'worker', stage: 'production', lastDeployedAt: new Date(Date.now() + 1000).toISOString(), lastDeployedSha: '3c9e1a7b55d0e4f1a2b3c4d5e6f708192a3b4c5d' } });
    await carry.sweepStuckRequests(ORG);

    const [supersededAsk] = await db.select().from(askSchema).where(eq(askSchema.id, ask.id));

    expect(supersededAsk!.status).toBe('superseded');

    // The rebuilt attempt fails again a different way — a second stop, on the
    // SAME sourceRef as the first (a worker rebuild is not a person's action,
    // so `since` never moved).
    const rebuilt = (await runsFor(r.id)).at(-1)!;
    await claimWorkerRun({ orgId: ORG, id: rebuilt.id, workerId: 'w-2', workerVersion: 'img-after' });
    await failWorkerRun({ orgId: ORG, id: rebuilt.id, workerId: 'w-2', error: 'verification failed: Claude produced no changes in the working tree (checks on the base: test=passed)' });

    const escalated = await carry.recoverFailedRun(ORG, rebuilt.id);

    expect(escalated.did).toBe('escalate');

    const meta = (await read(r.id)).metadata as { recovery: { stage: string; askId: number | null } };

    expect(meta.recovery.stage).toBe('stopped');
    expect(meta.recovery.askId).not.toBeNull();
    expect(meta.recovery.askId).not.toBe(ask.id);

    const [secondAsk] = await db.select().from(askSchema).where(eq(askSchema.id, meta.recovery.askId!));

    expect(secondAsk).toMatchObject({ status: 'open', kind: 'approval' });
    expect(secondAsk!.sourceRef).toMatch(new RegExp(`^${ask.sourceRef}:follow-up-`));
    expect(secondAsk!.body).toContain(`ask #${ask.id} on this request was already decided (superseded)`);

    // The first ask is untouched — still superseded, never reopened — and the
    // two are put in one group so a person opening either sees both.
    const [firstAfter] = await db.select().from(askSchema).where(eq(askSchema.id, ask.id));

    expect(firstAfter!.status).toBe('superseded');
    expect(firstAfter!.groupKey).not.toBeNull();
    expect(firstAfter!.groupKey).toBe(secondAsk!.groupKey);
  });

  it('an escalation that cannot file an open ask fails the run as an error, never a silent ok (never silent)', async () => {
    const AskService = await import('@/services/AskService');
    const real = AskService.upsertAsk;
    const spy = vi.spyOn(AskService, 'upsertAsk').mockImplementationOnce(async (opts) => {
      const out = await real(opts);
      // A bug reintroducing the old dedupe, or any other future fault, must
      // never look like success: simulate `upsertAsk` handing back an ask
      // that is not open.
      return { ...out, ask: { ...out.ask, status: 'rejected' } };
    });

    const r = await request({ product: 'rooms', title: 'A stop the ask service cannot file' });
    await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r.id, conversationId: 12, byPerson: true });
    const runId = await failNewest(r.id, 'verification failed: Claude produced no changes in the working tree (checks on the base: test=passed)');

    await expect(carry.recoverFailedRun(ORG, runId)).rejects.toThrow(/did not produce an open ask/);

    spy.mockRestore();
  });
});
