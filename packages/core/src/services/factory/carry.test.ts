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
const { actionRunSchema, agentSchema, askSchema, automationRunSchema, automationSchema, businessObjectSchema, eventLogSchema, toolCallSchema, trustRuleSchema, workerRunSchema, workspaceVersionSchema } = await import('@/models/Schema');
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
 * @param result - What the worker put on `result` (its typed `failure`).
 */
async function failNewest(requestId: number, error: string, failures: Array<{ scope: string; message: string }> = [], result?: Record<string, unknown>) {
  const run = (await runsFor(requestId)).at(-1)!;
  await claimWorkerRun({ orgId: ORG, id: run.id, workerId: 'w-1' });
  await failWorkerRun({ orgId: ORG, id: run.id, workerId: 'w-1', error, failures, result });
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

describe('an approved plan builds', () => {
  it('even while a second approve card for the same plan is still pending (#130)', async () => {
    const r = await request({ product: 'rooms', title: 'Rooms show who has not opened', state: 'building' });
    const [plan] = await db.insert(businessObjectSchema).values({
      orgId: ORG,
      typeId: types.architecture_plan!,
      title: 'Plan: who has not opened',
      status: 'approved',
      metadata: { requestId: r.id, status: 'approved', approvedBy: 'a person', approach: 'Match sends to opens in the core package and show them on the room page.', components: ['apps/web — the room page', 'packages/core — the match'], alternatives: ['None.'], verification: 'A test.', dataImpact: 'None.', ruleLevel: 'required' },
    }).returning();
    // The duplicate card a chat turn left behind, never decided.
    await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'factory.approve_plan', status: 'pending', input: { planId: plan!.id }, invokedBy: 'usr-1' } as never);

    const out = await carry.buildFromApprovedPlan(ORG, { planId: plan!.id, requestId: r.id, approvedBy: 'a person', byPerson: true });

    expect(out.did).not.toBe('skip');
    expect(await runsFor(r.id)).toHaveLength(1);
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

  it('a plan waiting in Review is a person\'s move, not a planning run that "ended without a plan" (#130)', async () => {
    const asked = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const setUp = async (title: string, withPlan: boolean) => {
      const r = await request({ product: 'rooms', title, state: 'building' });
      // Filed days ago and superseded as stale, so planning starts with no plan…
      const [plan] = withPlan
        ? await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.architecture_plan!, title: `Plan: ${title}`, createdAt: new Date(Date.now() - 3 * 86_400_000), metadata: { requestId: r.id, status: 'superseded', approach: 'Change the room page.', components: ['apps/web — the room page'] } }).returning()
        : [];
      await carry.startPlanning(ORG, { request: { id: r.id, title: r.title, meta: (await read(r.id)).metadata as Record<string, unknown> }, plan: null, why: 'the plan is stale', counted: true, trigger: 'recovery', by: 'the factory', at: asked });
      // …then the planner's filing refreshed that plan's pending proposal in place: back in review, nothing newer created.
      if (plan) {
        await db.update(businessObjectSchema).set({ metadata: { ...(plan.metadata as Record<string, unknown>), status: 'in_review' } }).where(eq(businessObjectSchema.id, plan.id));
      }
      return r;
    };
    const waiting = await setUp('Rooms remind who has not opened', true);
    const control = await setUp('Rooms remind who has not opened, unplanned', false);

    const { acted } = await carry.sweepStuckRequests(ORG);

    expect(acted.find(a => a.requestId === waiting.id)).toBeUndefined();
    expect(acted.find(a => a.requestId === control.id)).toBeDefined();
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

describe('Build on a closed request reopens it (Chris, 2026-09-29, #246: "Chris said open so open")', () => {
  it('a person\'s Build clears the verdict and starts the work; undo closes it again', async () => {
    const r = await request({ product: 'rooms', title: 'Rooms remember the theme', state: 'out_of_scope', recommendationState: 'rejected', decisionReason: 'Withdrawn.' });
    const { proposeAction, undoAction } = await import('@/services/ActionService');

    const res = await proposeAction({ orgId: ORG, actionId: 'factory.dispatch_task', input: { requestId: r.id, reason: 'Chris asked to restart it.' }, principal: { kind: 'user', id: 'usr-chris', role: 'member', scope: { orgId: ORG } }, invokedBy: 'usr-chris' });

    expect(res.status).toBe('done');

    const meta = (await read(r.id)).metadata as Record<string, unknown>;

    expect(meta.state === 'in_scope' || meta.state === 'building').toBe(true);
    expect(meta.recommendationState).toBe('approved');
    expect(String(meta.decisionReason)).toContain('Reopened by Build (usr-chris) after it was out of scope');

    await undoAction(res.runId, ORG, { by: 'usr-chris' });

    expect(((await read(r.id)).metadata as Record<string, unknown>).state).toBe('out_of_scope');
  });
});

describe('a planning run that ends without a plan is caught when it ends (#246, 2026-09-29)', () => {
  it('plans again at once, handing the planner and the page what its filing was told', async () => {
    const r = await request({ product: 'fleet', title: 'Fleet theme toggle' });
    await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r.id, conversationId: 12, byPerson: true });
    const asked = ((await read(r.id)).metadata as { recovery: { planRequestedAt: string } }).recovery.planRequestedAt;
    // The plan-request automation picked it up, ran, and its filing was refused.
    const [event] = (await db.select().from(eventLogSchema).where(and(eq(eventLogSchema.orgId, ORG), eq(eventLogSchema.type, 'factory.plan_requested'))))
      .filter(e => (e.payload as { requestId: number }).requestId === r.id);
    await db.update(eventLogSchema).set({ triggered: [{ slug: 'automation:factory-plan-request' }] } as never).where(eq(eventLogSchema.id, event!.id));
    // The automation says which call is its job; the run's mission run holds its calls.
    await db.insert(automationSchema).values({ orgId: ORG, slug: 'factory-plan-request', name: 'Write the plan', status: 'active', whenConfig: { event: 'factory.plan_requested' }, doConfig: { checkMission: 'close-the-gap', requireTool: 'file_architecture_plan' }, ownerAgentSlug: 'product-manager' } as never).onConflictDoNothing();
    const [run] = await db.insert(automationRunSchema).values({ orgId: ORG, slug: 'factory-plan-request', kind: 'mission_check', status: 'completed', input: { requestId: r.id }, targetRunId: 9246, startedAt: new Date(Date.parse(asked) + 1000) } as never).returning();
    await db.insert(toolCallSchema).values({ orgId: ORG, agentSlug: 'product-manager', tool: 'file_architecture_plan', missionRunId: 9246, input: { requestId: r.id }, output: 'Refused: nothing was filed (VALIDATION_FAILED). components must name a package.', createdAt: new Date(Date.parse(asked) + 2000) } as never);
    // A call some other turn made in the same window is not this run's.
    await db.insert(toolCallSchema).values({ orgId: ORG, agentSlug: 'product-manager', tool: 'file_architecture_plan', conversationId: 77, input: { requestId: r.id }, output: 'Not filed: something a chat turn was told.', createdAt: new Date(Date.parse(asked) + 3000) } as never);

    const out = await carry.planningRunEnded(ORG, { automationRunId: run!.id, slug: 'factory-plan-request' });

    expect(out).toMatchObject({ did: 'plan' });
    expect(out.line).toContain('its filing was answered: "Refused: nothing was filed (VALIDATION_FAILED). components must name a package."');

    // The next planner reads what stopped the last one.
    const next = (await db.select().from(eventLogSchema).where(and(eq(eventLogSchema.orgId, ORG), eq(eventLogSchema.type, 'factory.plan_requested'))))
      .filter(e => (e.payload as { requestId: number }).requestId === r.id)
      .map(e => (e.payload as { why: string }).why);

    expect(next.at(-1)).toContain('The last attempt did not file a plan');
    expect(next.at(-1)).toContain('components must name a package');

    // The page says so: planning again, which attempt, and why.
    const recovery = ((await read(r.id)).metadata as { recovery: { line: string } }).recovery;

    expect(recovery.line).toMatch(/^Planning again \(attempt \d of 3\) because the planning run \(automation run #\d+\) ended without filing a plan/);
  });

  it('plans again when planning went quiet, even with an old rejected plan on the request (#130, 2026-09-30)', async () => {
    const r = await request({ product: 'fleet', title: 'Fleet reminders' });
    await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r.id, conversationId: 12, byPerson: true });
    const meta = (await read(r.id)).metadata as Record<string, unknown> & { recovery: Record<string, unknown> };
    const asked = new Date(Date.now() - 2 * 3_600_000).toISOString();
    await db.update(businessObjectSchema).set({ metadata: { ...meta, recovery: { ...meta.recovery, stage: 'planning', planRequestedAt: asked } } }).where(eq(businessObjectSchema.id, r.id));
    await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.architecture_plan!, title: 'Plan: Fleet reminders', createdAt: new Date(Date.now() - 3 * 86_400_000), metadata: { requestId: r.id, status: 'rejected', approach: 'Old approach.' } });

    await carry.sweepStuckRequests(ORG);

    const log = ((await read(r.id)).metadata as { recovery: { log: Array<{ text: string }> } }).recovery.log.map(l => l.text);

    expect(log).toContain('Planning failed: the planning run ended without filing a plan.');
  });

  it('a plan whose row was rejected is not waiting on anyone, whatever its metadata says (#130)', async () => {
    const r = await request({ product: 'fleet', title: 'Fleet nudges' });
    await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r.id, conversationId: 12, byPerson: true });
    const meta = (await read(r.id)).metadata as Record<string, unknown> & { recovery: Record<string, unknown> };
    await db.update(businessObjectSchema).set({ metadata: { ...meta, recovery: { ...meta.recovery, stage: 'planning', planRequestedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() } } }).where(eq(businessObjectSchema.id, r.id));
    await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.architecture_plan!, title: 'Plan: Fleet nudges', status: 'rejected', createdAt: new Date(Date.now() - 3 * 86_400_000), metadata: { requestId: r.id, status: 'in_review', approach: 'Old approach.' } });

    await carry.sweepStuckRequests(ORG);

    const log = ((await read(r.id)).metadata as { recovery: { log: Array<{ text: string }> } }).recovery.log.map(l => l.text);

    expect(log).toContain('Planning failed: the planning run ended without filing a plan.');
  });

  it('does nothing for a run that is not a request\'s planning', async () => {
    expect((await carry.planningRunEnded(ORG, { automationRunId: 999999 })).did).toBe('no request on the run');
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

    expect(acted.find(a => a.requestId === r.id)).toMatchObject({ did: 'rebuilt:done', line: 'New worker (northwind-worker-production 3c9e1a7b) since the stop; building again.' });

    const [after] = await db.select().from(askSchema).where(eq(askSchema.id, ask.id));

    expect(after).toMatchObject({ status: 'superseded', decisionNote: 'New worker (northwind-worker-production 3c9e1a7b) since the stop; building again.' });

    const runs = await runsFor(r.id);

    expect(runs).toHaveLength(2);
    expect(runs[1]!.status).toBe('queued');

    const meta = (await read(r.id)).metadata as { workerRebuildResumedFor: string; recovery: { stage: string | null; askId: number | null; log: Array<{ text: string }> } };

    expect(meta.workerRebuildResumedFor).toBe('northwind-worker-production 3c9e1a7b');
    expect(meta.recovery.askId).toBeNull();
    expect(meta.recovery.log.at(-1)?.text).toBe(`New worker (northwind-worker-production 3c9e1a7b) since the stop; building again. Ask #${ask.id} resolved itself.`);

    // Once: a second sweep starts nothing more.
    await carry.sweepStuckRequests(ORG);

    expect(await runsFor(r.id)).toHaveLength(2);
  });

  it('builds any stop again once a new worker lands, not only an infrastructure one (2026-09-30: the paths fence)', async () => {
    const r = await request({ product: 'rooms', title: 'Rooms remember the theme' });
    await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r.id, conversationId: 12, byPerson: true });
    const first = (await runsFor(r.id)).at(-1)!;
    await claimWorkerRun({ orgId: ORG, id: first.id, workerId: 'w-1', workerVersion: 'img-before' });
    await failWorkerRun({ orgId: ORG, id: first.id, workerId: 'w-1', error: 'out of bounds: the approved plan cannot be built inside the allowed paths', failures: [{ scope: 'out_of_bounds', message: 'the theme column lives outside the allowed paths' }] });
    const attempt = (n: number) => ({ n, at: '2026-09-30T02:00:00Z', kind: 'build', trigger: 'retry', runId: null, taskId: null, line: 'x', failure: null });
    await db.update(businessObjectSchema).set({ metadata: { ...((await read(r.id)).metadata as Record<string, unknown>), recovery: { log: [], line: null, askId: null, limit: 3, since: null, stage: 'recovering', attempts: [attempt(1), attempt(2), attempt(3)], handledRunIds: [], planRequestedAt: null } } }).where(eq(businessObjectSchema.id, r.id));
    await carry.stopIfAtLimit(ORG, r.id, 'the engineer could not work outside the plan\'s paths');
    const askId = ((await read(r.id)).metadata as { recovery: { askId: number } }).recovery.askId;

    const envType = (await getObjectTypeBySlug(ORG, 'environment')) ?? (await createObjectType({ slug: 'environment', label: 'Environment' }, ORG))[0];
    await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: envType!.id, title: 'Northwind factory worker (production)', metadata: { slug: 'northwind-worker-production', surface: 'worker', stage: 'production', lastDeployedAt: new Date(Date.now() + 1000).toISOString(), lastDeployedSha: '5d2f0c9e11aa22bb33cc44dd55ee66ff77889900' } });

    const out = await carry.resumeAfterWorkerRebuild(ORG);

    expect(out.find(a => a.requestId === r.id)).toMatchObject({ did: 'rebuilt:done' });

    const [after] = await db.select().from(askSchema).where(eq(askSchema.id, askId));

    expect(after!.status).toBe('superseded');
    expect(await runsFor(r.id)).toHaveLength(2);
  });

  it('builds a stop with no run behind it from its approved plan (#233, 2026-09-30)', async () => {
    const r = await request({ product: 'rooms', title: 'Rooms pin a note' });
    await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.architecture_plan!, title: 'Plan: Rooms pin a note', metadata: { requestId: r.id, status: 'approved', approvedBy: 'usr-dana', approach: 'Add the note to the room page.', components: ['apps/web — the room page'] } });
    const attempt = (n: number) => ({ n, at: '2026-09-29T07:00:00Z', kind: 'build', trigger: 'retry', runId: null, taskId: null, line: 'x', failure: null });
    await db.update(businessObjectSchema).set({ metadata: { ...((await read(r.id)).metadata as Record<string, unknown>), recovery: { log: [], line: null, askId: null, limit: 3, since: null, stage: 'recovering', attempts: [attempt(1), attempt(2), attempt(3)], handledRunIds: [], planRequestedAt: null } } }).where(eq(businessObjectSchema.id, r.id));
    await carry.stopIfAtLimit(ORG, r.id, 'the limit on automatic attempts is reached');
    const envType = (await getObjectTypeBySlug(ORG, 'environment')) ?? (await createObjectType({ slug: 'environment', label: 'Environment' }, ORG))[0];
    await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: envType!.id, title: 'Northwind factory worker (production)', metadata: { slug: 'northwind-worker-production', surface: 'worker', stage: 'production', lastDeployedAt: new Date(Date.now() + 1000).toISOString(), lastDeployedSha: '7e1d2c3b4a5f60718293a4b5c6d7e8f901234567' } });

    const out = await carry.resumeAfterWorkerRebuild(ORG);

    expect(out.find(a => a.requestId === r.id)).toMatchObject({ did: 'rebuilt:done' });
    expect(await runsFor(r.id)).toHaveLength(1);
  });

  it('builds a stop again once after a deploy, even with no new worker (#201, 2026-09-30: the fix shipped in core)', async () => {
    const r = await request({ product: 'rooms', title: 'Rooms keep a pinned note' });
    await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r.id, conversationId: 12, byPerson: true });
    const first = (await runsFor(r.id)).at(-1)!;
    await claimWorkerRun({ orgId: ORG, id: first.id, workerId: 'w-1', workerVersion: 'img-same' });
    await failWorkerRun({ orgId: ORG, id: first.id, workerId: 'w-1', error: 'prepare failed: git clone failed (128): remote: Repository not found.', failures: [{ scope: 'git', message: 'Repository not found.' }] });
    const attempt = (n: number) => ({ n, at: '2026-09-30T04:00:00Z', kind: 'build', trigger: 'retry', runId: null, taskId: null, line: 'x', failure: null });
    await db.update(businessObjectSchema).set({ metadata: { ...((await read(r.id)).metadata as Record<string, unknown>), recovery: { log: [], line: null, askId: null, limit: 3, since: null, stage: 'recovering', attempts: [attempt(1), attempt(2), attempt(3)], handledRunIds: [], planRequestedAt: null } } }).where(eq(businessObjectSchema.id, r.id));
    await carry.stopIfAtLimit(ORG, r.id, 'the repository could not be cloned');

    // A deploy applies the workspace after the stop.
    await db.insert(workspaceVersionSchema).values({ orgId: ORG, sha: 'local-7a1b', status: 'applied', appliedAt: new Date(Date.now() + 1000) });

    const out = await carry.resumeAfterWorkerRebuild(ORG);

    // Run alone, the deploy is the only change since the stop; in the full file,
    // earlier tests' worker environments may answer first. Either resumes it.
    expect(out.find(a => a.requestId === r.id)).toMatchObject({ did: 'rebuilt:done', line: expect.stringMatching(/since the stop.*building again\.$/) });
    expect(await runsFor(r.id)).toHaveLength(2);

    // Once per deploy.
    expect((await carry.resumeAfterWorkerRebuild(ORG)).find(a => a.requestId === r.id)).toBeUndefined();
  });

  it('stop → approve → new failure files a second, open ask — never reopening the first (prod, 2026-09-29: ask #220)', async () => {
    const { r, ask } = await stoppedOnTheWorker('Open alerts');

    // The worker is rebuilt: the first stop resolves itself and the build runs again.
    const envType = (await getObjectTypeBySlug(ORG, 'environment')) ?? (await createObjectType({ slug: 'environment', label: 'Environment' }, ORG))[0];
    await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: envType!.id, title: 'Northwind factory worker (production)', metadata: { slug: 'northwind-worker-production', surface: 'worker', stage: 'production', lastDeployedAt: new Date(Date.now() + 1000).toISOString(), lastDeployedSha: '3c9e1a7b55d0e4f1a2b3c4d5e6f708192a3b4c5d' } });
    await carry.sweepStuckRequests(ORG);

    const [supersededAsk] = await db.select().from(askSchema).where(eq(askSchema.id, ask.id));

    expect(supersededAsk!.status).toBe('superseded');

    // The rebuilt attempt fails again a different way — a second stop. A new
    // worker starts a new count (2026-09-30), so it is its own ask.
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
    expect(secondAsk!.sourceRef).not.toBe(ask.sourceRef);

    // The first ask is untouched — still superseded, never reopened.
    const [firstAfter] = await db.select().from(askSchema).where(eq(askSchema.id, ask.id));

    expect(firstAfter!.status).toBe('superseded');
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

describe('a stale plan is planned again (#130, 2026-09-29: a plan written before a rename)', () => {
  /**
   * A request with an approved plan, built from it on intake.
   * @param title - The request's title.
   * @param components - The plan's components.
   */
  async function builtFromPlan(title: string, components: string[]) {
    const r = await request({ product: 'rooms', title });
    const [plan] = await db.insert(businessObjectSchema).values({
      orgId: ORG,
      typeId: types.architecture_plan!,
      title: `Plan: ${title}`,
      metadata: { requestId: r.id, status: 'approved', approvedBy: 'usr-dana', approvedAt: '2026-09-25T21:00:00.000Z', approach: 'Change the room page.', components, repoSlugs: ['Acme/northwind-core'] },
    }).returning();
    await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r.id, conversationId: 12, byPerson: true });
    return { r, plan: plan! };
  }

  const planRequests = async (requestId: number) => (await db.select().from(eventLogSchema).where(and(eq(eventLogSchema.orgId, ORG), eq(eventLogSchema.type, 'factory.plan_requested'))))
    .filter(e => (e.payload as { requestId: number }).requestId === requestId);

  it('paths_missing from the worker: the plan is superseded and planned again with the paths that exist, never sent again', async () => {
    const { r, plan } = await builtFromPlan('Rooms show who has not opened the invite', ['apps/web — the room page lists who has not opened']);

    expect(await runsFor(r.id)).toHaveLength(1);

    const runId = await failNewest(r.id, 'paths missing: the allowed paths name apps/old-web (did you mean apps/web?), which is not in the repository. Nothing was changed and no model was called.', [{ scope: 'paths_missing', message: 'the allowed paths name apps/old-web (did you mean apps/web?), which is not in the repository' }], {
      failure: { kind: 'paths_missing', missing: ['apps/old-web/src/**'], suggest: ['apps/web/src/**'], roots: [{ missing: 'apps/old-web', suggest: 'apps/web' }], reason: 'the allowed paths name apps/old-web (did you mean apps/web?), which is not in the repository' },
    });
    const out = await carry.recoverFailedRun(ORG, runId);

    expect(out).toMatchObject({ did: 'replan', line: expect.stringMatching(/^Recovered: planning again because the plan no longer fits the repository: the allowed paths name apps\/old-web .*; plan #\d+ is superseded\.$/) });
    // Nothing was sent again: the same paths would fail the same way.
    expect(await runsFor(r.id)).toHaveLength(1);
    expect(((await read(plan.id)).metadata as Record<string, unknown>).status).toBe('superseded');

    const meta = (await read(r.id)).metadata as { recovery: { stage: string; attempts: Array<{ kind: string; trigger: string }> } };

    expect(meta.recovery.stage).toBe('planning');
    // The planning step is an attempt of the limit.
    expect(meta.recovery.attempts.at(-1)).toMatchObject({ kind: 'plan', trigger: 'recovery' });

    const [asked] = await planRequests(r.id);

    expect((asked!.payload as { why: string }).why).toContain('Name these instead: apps/web/src/**');

    // The new plan supersedes the old one, on both records.
    const [next] = await db.insert(businessObjectSchema).values({
      orgId: ORG,
      typeId: types.architecture_plan!,
      title: 'Plan: Rooms show who has not opened the invite (again)',
      metadata: { requestId: r.id, status: 'in_review', approach: 'Change the room page in apps/web.', components: ['apps/web — the room page lists who has not opened'], alternatives: ['None.'], verification: 'A test.', dataImpact: 'None.' },
    }).returning();
    await carry.reviewFiledPlan(ORG, { objectType: 'architecture_plan', objectId: next!.id });

    expect(((await read(plan.id)).metadata as Record<string, unknown>).supersededBy).toBe(next!.id);
    expect(((await read(next!.id)).metadata as Record<string, unknown>).supersedes).toEqual([plan.id]);
  });

  it('out_of_bounds from the worker: the engineer\'s words, and a plan again rather than "no changes"', async () => {
    const { r } = await builtFromPlan('Rooms remind who has not opened', ['apps/web — the Remind dialog']);
    const reason = 'I stopped without changing anything, because the plan can\'t be built inside the allowed paths.';
    const out = await carry.recoverFailedRun(ORG, await failNewest(r.id, `out of bounds: Claude stopped because the work cannot be built inside the allowed paths. Nothing was changed. Claude said: ${reason}`, [{ scope: 'out_of_bounds', message: reason }], { failure: { kind: 'out_of_bounds', reason, detail: `${reason}\n\n- Reminders need a schema change.` } }));

    expect(out.did).toBe('replan');
    expect(out.line).toContain('the engineer stopped because the work cannot be built inside its paths');
    expect(((await planRequests(r.id))[0]!.payload as { why: string }).why).toContain('The engineer said: I stopped without changing anything');
  });

  it('at dispatch: a plan whose components name an app the repo record no longer lists is planned again before anything is sent', async () => {
    const { r, plan } = await builtFromPlan('Rooms keep their invite list', ['apps/old-web — the invite list', 'packages/core — the invite read']);

    expect(await runsFor(r.id)).toHaveLength(0);
    expect(((await read(plan.id)).metadata as Record<string, unknown>)).toMatchObject({ status: 'superseded', supersededReason: 'it names apps/old-web (now apps/web), which the repository no longer has' });

    const meta = (await read(r.id)).metadata as { recovery: { stage: string } };

    expect(meta.recovery.stage).toBe('planning');
    expect(((await planRequests(r.id))[0]!.payload as { why: string }).why).toMatch(/^plan #\d+ is stale; .*apps\/old-web \(now apps\/web\).*Name these instead: apps\/web/);

    // Undo puts the plan back as it was.
    const { factoryDispatchAction } = await import('@/libs/actions/factory-dispatch');
    const [dispatch] = (await db.select().from(actionRunSchema).where(and(eq(actionRunSchema.orgId, ORG), eq(actionRunSchema.actionId, 'factory.dispatch_task'))))
      .filter(a => (a.input as { requestId?: number }).requestId === r.id);
    await factoryDispatchAction.undo!({ orgId: ORG } as never, dispatch!.input as never, dispatch!.result as never);

    expect(((await read(plan.id)).metadata as Record<string, unknown>).status).toBe('approved');
  });

  it('the sweep answers a stop a stale plan explains: an older worker said only "no changes"', async () => {
    const { r, plan } = await builtFromPlan('Rooms show the invite time', ['apps/web — the invite time']);
    // The stop as it stands in production: "no changes", same contract, one ask.
    const runId = await failNewest(r.id, 'verification failed: Claude produced no changes in the working tree (checks on the base: test=passed)');

    expect((await carry.recoverFailedRun(ORG, runId)).did).toBe('escalate');

    const askId = ((await read(r.id)).metadata as { recovery: { askId: number } }).recovery.askId;
    // The plan was written before the rename: its app is gone from the repo record.
    await db.update(businessObjectSchema).set({ metadata: { ...((await read(plan.id)).metadata as Record<string, unknown>), components: ['apps/old-web — the invite time'] } }).where(eq(businessObjectSchema.id, plan.id));

    const { acted } = await carry.sweepStuckRequests(ORG);

    expect(acted.find(a => a.requestId === r.id)).toMatchObject({ did: 'replan', line: expect.stringContaining('apps/old-web (now apps/web)') });

    const [ask] = await db.select().from(askSchema).where(eq(askSchema.id, askId));

    expect(ask!.status).toBe('superseded');
    expect(((await read(plan.id)).metadata as Record<string, unknown>).status).toBe('superseded');

    const meta = (await read(r.id)).metadata as { stalePlanReplannedFor: number; recovery: { stage: string; askId: number | null } };

    expect(meta).toMatchObject({ stalePlanReplannedFor: runId, recovery: { stage: 'planning', askId: null } });
    expect(await planRequests(r.id)).toHaveLength(1);

    // Once per failed run: a second sweep does not supersede or plan again for
    // the stale plan (with no planner in this fixture, it may notice the
    // planning never started — that is the planning step's own rule).
    const again = await carry.sweepStuckRequests(ORG);

    expect(again.acted.find(a => a.requestId === r.id)?.did).not.toBe('replan');
  });
});

describe('a blocker whose move was made is cleared (#130, 2026-09-29)', () => {
  const planMeta = { approach: 'Match sends to opens in the core package.', components: ['packages/core — the match'], alternatives: ['None.'], verification: 'A test.', dataImpact: 'None.' };

  it('when the plan it names is approved, and the Activity says why', async () => {
    const r = await request({ product: 'rooms', title: 'Remind who has not opened', state: 'building' });
    const [plan] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.architecture_plan!, title: 'Plan: remind', status: 'approved', metadata: { requestId: r.id, status: 'approved', approvedBy: 'a person', approvedAt: '2026-09-29T14:20:14.000Z', ...planMeta } }).returning();
    await db.update(businessObjectSchema).set({ metadata: { ...(r.metadata as Record<string, unknown>), blocker: { what: 'The replanned plan cannot be filed', owner: 'dana@northwind.example', next: `approve plan ${plan!.id}` } } }).where(eq(businessObjectSchema.id, r.id));

    await carry.buildFromApprovedPlan(ORG, { planId: plan!.id, requestId: r.id, approvedBy: 'a person', byPerson: true });
    const meta = (await read(r.id)).metadata as { blocker: unknown; recovery: { log: Array<{ text: string }> } };

    expect(meta.blocker).toBeNull();
    expect(meta.recovery.log.some(l => l.text.startsWith(`Cleared the blocker, because plan #${plan!.id} was approved (2026-09-29 14:20 UTC)`))).toBe(true);
  });

  it('by the sweep when the ask it waits on was answered elsewhere, and not while it is open', async () => {
    const [open] = await db.insert(askSchema).values({ orgId: ORG, kind: 'decision', title: 'Which region?', status: 'open' } as never).returning();
    const [answered] = await db.insert(askSchema).values({ orgId: ORG, kind: 'decision', title: 'Which bucket?', status: 'approved', decidedAt: new Date('2026-09-29T10:00:00Z') } as never).returning();
    const waiting = await request({ product: 'rooms', title: 'Export waits on a region', state: 'decided', blocker: { what: 'The region is not chosen', owner: 'dana@northwind.example', next: 'choose it', waitsOn: [{ kind: 'ask', id: open!.id }] } });
    const moved = await request({ product: 'rooms', title: 'Export waits on a bucket', state: 'decided', blocker: { what: 'The bucket is not chosen', owner: 'dana@northwind.example', next: `answer ask #${answered!.id}` } });

    const { acted } = await carry.sweepStuckRequests(ORG, new Date(), 100);

    expect(acted.find(a => a.requestId === moved.id)?.did).toBe('blocker cleared');
    expect(((await read(moved.id)).metadata as { blocker: unknown }).blocker).toBeNull();
    expect(((await read(waiting.id)).metadata as { blocker: unknown }).blocker).not.toBeNull();
  });
});

describe('the contract changed after QA (#201)', () => {
  it('holds the waiting merge and starts the next attempt against the new contract', async () => {
    const r = await request({ product: 'rooms', title: 'Rooms are scoped to the acting team', state: 'building' });
    const [task] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.engineering_task!, title: 'Scope rooms', status: 'accepted', metadata: { requestId: r.id, status: 'accepted', prUrl: 'https://github.com/acme/northwind/pull/12', verdict: { value: 'approve', proven: 6, total: 6 }, branch: 'factory/t12' } }).returning();
    const [merge] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'git.merge', status: 'pending', input: { taskId: task!.id, riskClass: 'logic', title: 'Merge', summary: 'x', recipe: 'merge', commitSha: 'a1b2c3d', rollback: 'revert the merge' } } as never).returning();

    const since = new Date(Date.now() - 1_000);
    const out = await carry.reopenForContractChange(ORG, { objectId: r.id, objectType: 'request', fields: 'acceptance,outcome', actor: 'usr-chris' });

    expect(out.did).toBe('reopen');
    expect((await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, merge!.id)))[0]!.status).toBe('rejected');
    // Held (Changes asked), and — since the next attempt started straight away — superseded by it.
    expect(['changes_requested', 'abandoned']).toContain(((await read(task!.id)).metadata as { status: string }).status);

    const [next] = (await db.select().from(actionRunSchema).where(and(eq(actionRunSchema.orgId, ORG), eq(actionRunSchema.actionId, 'factory.dispatch_task'))))
      .filter(a => Number((a.input as { requestId?: unknown }).requestId) === r.id);

    expect((next!.input as { recoveryClass?: string }).recoveryClass).toBe('contract_changed');
    // The write that changed the contract is told what it started, so the answer does not offer to dispatch.
    expect(await carry.contractChangeReceipt(ORG, r.id, since, 100)).toMatch(new RegExp(`merge #${merge!.id} is held and the next attempt is (started|filed)`));
  });

  it('does nothing when no contract field changed, or no merge is waiting', async () => {
    const r = await request({ product: 'rooms', title: 'Rooms show their owner', state: 'building' });

    expect((await carry.reopenForContractChange(ORG, { objectId: r.id, fields: 'priority' })).did).toBe('no contract field changed');
    expect((await carry.reopenForContractChange(ORG, { objectId: r.id, fields: 'acceptance' })).did).toBe('no task to reopen');
    expect(await carry.contractChangeReceipt(ORG, r.id, new Date(), 100)).toBeNull();
  });
});

describe('planning and building each get the whole retry budget (#246, 2026-09-29)', () => {
  it('two failed planning attempts leave the build its retry', async () => {
    const r = await request({ product: 'rooms', title: 'Rooms keep a light theme' });
    const attempt = (n: number, kind: 'plan' | 'build') => ({ n, at: '2026-09-29T23:40:00Z', kind, trigger: 'recovery', runId: null, taskId: null, line: 'x', failure: kind === 'plan' ? { class: 'no_plan', sentence: 'refused' } : null });
    await db.update(businessObjectSchema).set({ metadata: { ...((await read(r.id)).metadata as Record<string, unknown>), recovery: { log: [], line: null, askId: null, limit: 3, since: null, stage: 'building', attempts: [attempt(1, 'plan'), attempt(2, 'plan'), attempt(3, 'build')], handledRunIds: [], planRequestedAt: null } } }).where(eq(businessObjectSchema.id, r.id));

    // One build so far: QA's send-back is retried, not stopped.
    expect(await carry.stopIfAtLimit(ORG, r.id, 'QA sent attempt #1 back')).toBeNull();
  });
});

describe('nothing waits on a review that never starts (2026-09-30, #269: CI failed, QA never ran)', () => {
  async function waitingOnQa(title: string, prNumber: number) {
    const r = await request({ product: 'rooms', title });
    await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r.id, conversationId: 12, byPerson: true });
    const tasks = (await db.select().from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, ORG), eq(businessObjectSchema.typeId, types.engineering_task!))))
      .filter(t => Number((t.metadata as Record<string, unknown>).requestId) === r.id);
    const task = tasks.at(-1)!;
    // The engineer finished: its run is over, only QA is left.
    for (const run of await runsFor(r.id)) {
      await db.update(workerRunSchema).set({ status: 'completed' }).where(eq(workerRunSchema.id, run.id));
    }
    const prUrl = `https://github.com/Acme/northwind-core/pull/${prNumber}`;
    await db.update(businessObjectSchema).set({ status: 'awaiting_review', updatedAt: new Date(Date.now() - 3_600_000), metadata: { ...(task.metadata as Record<string, unknown>), status: 'awaiting_review', prUrl, commitSha: 'bc9f315a148d' } }).where(eq(businessObjectSchema.id, task.id));
    return { r, task, prUrl };
  }

  it('builds the attempt again when CI failed on its pull request', async () => {
    const { ciFailed } = await import('./ciFailed');
    const { r, task, prUrl } = await waitingOnQa('Rooms open for invited guests', 140);
    const before = (await runsFor(r.id)).length;

    const out = await ciFailed(ORG, { url: prUrl, conclusion: 'failure', headSha: 'bc9f315a148d3d8d', failedChecks: ['checks'] });

    expect(out.did).toBe('ci failed: built again');
    expect((await read(task.id)).status).toBe('changes_requested');
    // On its own where the workspace's retry rule says so (production); a card here.
    expect(out.line).toMatch(/^CI failed on the pull request \(checks\)\. Build again (started on its own|is on a card for a person)/);

    void before;
  });

  it('the sweep finds a task waiting on QA with a red CI behind it, and one whose green CI never started a review', async () => {
    const { watchAwaitingReview } = await import('./ciFailed');
    const red = await waitingOnQa('Rooms show who joined', 141);
    const green = await waitingOnQa('Rooms show who left', 142);
    await db.insert(eventLogSchema).values([
      { orgId: ORG, type: 'pr.checks_completed', payload: { url: red.prUrl, conclusion: 'failure', headSha: 'bc9f315a148d', failedChecks: ['test'] }, dedupeKey: 'github:141:checks' },
      { orgId: ORG, type: 'pr.checks_completed', payload: { url: green.prUrl, conclusion: 'success', headSha: 'bc9f315a148d' }, dedupeKey: 'github:142:checks' },
    ] as never);

    const out = await watchAwaitingReview(ORG);

    expect(out.map(o => o.did).sort()).toEqual(['ci failed: built again', 'review started again']);
    expect((await read(red.task.id)).status).toBe('changes_requested');

    const raised = (await db.select().from(eventLogSchema).where(and(eq(eventLogSchema.orgId, ORG), eq(eventLogSchema.type, 'pr.checks_completed'))))
      .filter(e => (e.payload as { url: string }).url === green.prUrl);

    expect(raised).toHaveLength(2);
  });
});

describe('a stop whose ask is closed is still a stop (2026-09-30, "Open alerts" #124)', () => {
  it('resumes on a deploy after the stop, though no ask is open', async () => {
    const r = await request({ product: 'rooms', title: 'Rooms alert on the first open' });
    const at = new Date(Date.now() - 86_400_000).toISOString();
    await db.update(businessObjectSchema).set({ metadata: { ...((await read(r.id)).metadata as Record<string, unknown>), recovery: { log: [{ at, text: 'Stopped after 2 attempts.', runId: null }], line: 'Stopped after 2 attempts.', askId: 999999, limit: 3, since: null, stage: 'stopped', attempts: [], handledRunIds: [], planRequestedAt: null } } }).where(eq(businessObjectSchema.id, r.id));
    await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.architecture_plan!, title: 'Plan: Rooms alert on the first open', metadata: { requestId: r.id, status: 'approved', approvedBy: 'usr-dana', approach: 'Alert on the first open.', components: ['apps/web — the room page'] } });
    await db.insert(workspaceVersionSchema).values({ orgId: ORG, sha: 'local-9c2d', status: 'applied', appliedAt: new Date() });

    const out = await carry.resumeAfterWorkerRebuild(ORG);

    expect(out.find(a => a.requestId === r.id)).toMatchObject({ did: 'rebuilt:done' });
    expect(((await read(r.id)).metadata as { recovery: { stage: string | null } }).recovery.stage).not.toBe('stopped');
  });
});
