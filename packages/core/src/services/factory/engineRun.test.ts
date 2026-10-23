/**
 * The engine scoreboard (ADR 0005): one row per engineering run in one shape,
 * whichever engine did it, kept up to date as the work's outcome comes in,
 * and eval runs in the same shape.
 *
 * Runs against PGlite. Fixtures are fictional.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { businessObjectSchema, businessObjectTypeSchema, engineRunSchema, workerRunSchema } = await import('@/models/Schema');
const { eq } = await import('drizzle-orm');
const { engineRunFromEvalRun, engineRunFromWorkerRun, importEvalRuns, listEngineRuns, loadEngineScoreboard, outcomeOf, recordEngineRun, repoName, scoreboardOf, syncEngineRuns } = await import('./engineRun');

const PR = 'https://github.example/kestrel/app/pull/41';
const contract = (engine?: string) => ({ task_id: 'kestrel-t9', repo: 'https://github.example/kestrel/app.git', base_branch: 'dev', risk_class: 'ui', request_id: '7', ...(engine ? { engine: { id: engine } } : {}) });

describe('where a run\'s work ended up', () => {
  const base = { status: 'completed', prUrl: PR, latest: true, task: null, merged: false, reverted: false };

  it('reads the furthest the work got, a revert above all', () => {
    expect(outcomeOf({ ...base, merged: true, reverted: true })).toBe('reverted');
    expect(outcomeOf({ ...base, merged: true })).toBe('merged');
    expect(outcomeOf({ ...base, task: { status: 'accepted', verdict: 'approve', prUrl: PR, prState: 'open' } })).toBe('accepted');
    expect(outcomeOf({ ...base, task: { status: 'awaiting_review', verdict: 'approve', prUrl: PR, prState: 'open' } })).toBe('qa_passed');
    expect(outcomeOf({ ...base, task: { status: 'changes_requested', verdict: 'changes', prUrl: PR, prState: 'open' } })).toBe('qa_failed');
    expect(outcomeOf(base)).toBe('pr_opened');
    expect(outcomeOf({ ...base, prUrl: null })).toBe('no_pr');
    expect(outcomeOf({ ...base, status: 'failed' })).toBe('failed');
    expect(outcomeOf({ ...base, status: 'running' })).toBe('running');
    expect(outcomeOf({ ...base, status: 'cancelled' })).toBe('cancelled');
  });

  it('gives the task\'s outcome only to its latest run; an earlier one with a PR was superseded', () => {
    const task = { status: 'accepted', verdict: 'approve', prUrl: 'https://github.example/kestrel/app/pull/42', prState: 'open' };

    expect(outcomeOf({ ...base, latest: false, task })).toBe('superseded');
    expect(outcomeOf({ ...base, latest: false, prUrl: null, status: 'failed', task })).toBe('failed');
  });

  it('names a repo by owner/name', () => {
    expect(repoName('https://github.example/kestrel/app.git')).toBe('kestrel/app');
    expect(repoName('kestrel/app')).toBe('kestrel/app');
    expect(repoName(null)).toBeNull();
  });
});

describe('a factory run\'s row', () => {
  it('carries engine, model, seat, task, repo, time, tokens, cost, checks, guard and size', () => {
    const claimedAt = new Date('2026-10-22T10:00:00Z');
    const row = engineRunFromWorkerRun({
      id: 5,
      orgId: 'org_k',
      agentSlug: 'task-engineer',
      status: 'completed',
      model: null,
      input: { task: contract('openhands'), record: { type: 'engineering_task', id: 9 }, route: { engine: 'openhands', policy: 'static', reason: 'the task-engineer seat\'s harness.engine' }, requestId: 7 },
      result: { engine: 'openhands', pr_url: PR, elapsed_s: 300, files_changed: ['a', 'b'], diff_stat: { files: 2, insertions: 40, deletions: 5 }, checks: [{ status: 'passed' }, { status: 'failed' }], token_usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30 } },
      counts: { guardDenials: 2, permissionDenials: 1 },
      cents: 123,
      claimedAt,
      createdAt: claimedAt,
      completedAt: new Date('2026-10-22T10:06:00Z'),
    }, { task: { status: 'awaiting_review', verdict: null, prUrl: PR, prState: 'open' }, attempt: 1, runsOfTask: 2, reverted: false });

    expect(row).toMatchObject({
      engine: 'openhands',
      model: 'claude-opus-5-5',
      seat: 'task-engineer',
      routePolicy: 'static',
      taskId: 9,
      requestId: 7,
      repo: 'kestrel/app',
      baseBranch: 'dev',
      durationS: 300,
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cents: 123,
      checksPassed: 1,
      checksTotal: 2,
      guardViolations: 2,
      filesTouched: 2,
      linesAdded: 40,
      linesRemoved: 5,
      complexity: 'small',
      attempt: 1,
      retries: 1,
      outcome: 'superseded',
    });
  });

  it('reads the default engine when nothing names one', () => {
    const row = engineRunFromWorkerRun({ id: 6, orgId: 'org_k', agentSlug: 'task-engineer', status: 'failed', model: 'claude-x', input: { task: contract() }, result: null, counts: {}, cents: 0, claimedAt: null, createdAt: new Date(), completedAt: null }, { task: null, attempt: 1, runsOfTask: 1, reverted: false });

    expect(row).toMatchObject({ engine: 'claude-cli', model: 'claude-x', outcome: 'failed', guardViolations: 0, filesTouched: null, complexity: null });
  });
});

describe('the board, from the runs', () => {
  it('syncs the runs and the task\'s outcome, again as it changes, and scores each engine', async () => {
    const orgId = 'org_engine_kestrel';
    const schema = { type: 'object', properties: {} };
    const typeId = (await db.insert(businessObjectTypeSchema).values({ orgId, slug: 'engineering_task', label: 'Task', schema } as never).returning({ id: businessObjectTypeSchema.id }))[0]!.id;
    const task = (await db.insert(businessObjectSchema).values({ orgId, typeId, title: 'Upload date', metadata: { status: 'awaiting_review', prUrl: PR, prState: 'open' } } as never).returning({ id: businessObjectSchema.id }))[0]!.id;
    const other = (await db.insert(businessObjectSchema).values({ orgId, typeId, title: 'Page count', metadata: { status: 'accepted', verdict: { value: 'approve' } } } as never).returning({ id: businessObjectSchema.id }))[0]!.id;
    const run = async (taskId: number, engine: string | null, status: string, result: Record<string, unknown> | null, cents: number) =>
      (await db.insert(workerRunSchema).values({ orgId, agentSlug: 'task-engineer', status, cents, input: { task: contract(engine ?? undefined), record: { type: 'engineering_task', id: taskId } }, result } as never).returning())[0]!;
    await run(task, 'openhands', 'failed', null, 50);
    const second = await run(task, 'openhands', 'completed', { engine: 'openhands', pr_url: PR, elapsed_s: 200 }, 150);
    await run(other, null, 'completed', { pr_url: 'https://github.example/kestrel/app/pull/40', elapsed_s: 400 }, 300);
    // Not engineering work: no contract, no row.
    await db.insert(workerRunSchema).values({ orgId, agentSlug: 'lead', status: 'completed', input: { message: 'plan' } } as never);

    expect(await syncEngineRuns(orgId)).toBe(3);

    let rows = await listEngineRuns(orgId);

    expect(rows.map(r => [r.engine, r.attempt, r.retries, r.outcome])).toEqual([
      ['claude-cli', 1, 0, 'accepted'],
      ['openhands', 2, 0, 'pr_opened'],
      ['openhands', 1, 1, 'failed'],
    ]);

    // The merge arrives; the run's end re-syncs its task, and a second sync changes nothing more.
    await db.update(businessObjectSchema).set({ metadata: { status: 'accepted', verdict: { value: 'approve' }, prUrl: PR, prState: 'merged' } }).where(eq(businessObjectSchema.id, task));
    await recordEngineRun(second);
    await syncEngineRuns(orgId);
    rows = await listEngineRuns(orgId, { engine: 'openhands' });

    expect(rows.map(r => [r.outcome, r.merged, r.accepted])).toEqual([['merged', true, true], ['failed', false, null]]);
    expect((await db.select().from(engineRunSchema).where(eq(engineRunSchema.orgId, orgId))).length).toBe(3);

    const board = await loadEngineScoreboard(orgId);
    const oh = board.engines.find(e => e.engine === 'openhands')!;

    expect(oh).toMatchObject({ runs: 2, prs: 1, merged: 1, failed: 1, totalCents: 200, centsPerLanded: 200, retries: 1, acceptRate: 0.5 });
    expect(board.engines.find(e => e.engine === 'claude-cli')).toMatchObject({ runs: 1, accepted: 1, qaPassRate: 1, medianDurationS: 400 });
  });
});

describe('eval runs, in the same shape', () => {
  const line = { case: 'c01-page-count', tier: 'core', complexity: 2, risk_class: 'ui', run: 1, attempts: [{ startedAt: '2026-10-23T02:13:10.584Z', prUrl: 'https://github.example/sandbox/pull/90', elapsedS: 163, model: 'claude-opus-5-5', tokenUsage: { model: 'claude-opus-5-5', input_tokens: 46, output_tokens: 11982, cache_read_input_tokens: 703206 }, checks: [{ status: 'passed' }, { status: 'passed' }] }], score: { accepted: true, attemptsUsed: 1, costUsd: 0.56, infra: false, guardViolation: false } };

  it('maps the grader onto QA and acceptance', () => {
    expect(engineRunFromEvalRun('org_e', '2026-10-22-openhands', 'openhands', line)).toMatchObject({ source: 'eval', evalKey: '2026-10-22-openhands:c01-page-count:1', engine: 'openhands', cents: 56, durationS: 163, outcome: 'accepted', qaVerdict: 'approve', complexity: 'small', checksPassed: 2 });
    expect(engineRunFromEvalRun('org_e', 'x', 'openhands', { ...line, score: { ...line.score, accepted: false } }).outcome).toBe('qa_failed');
    expect(engineRunFromEvalRun('org_e', 'x', 'openhands', { ...line, score: { ...line.score, infra: true } }).outcome).toBe('failed');
  });

  it('imports, and a re-import replaces rather than adds', async () => {
    const orgId = 'org_engine_eval';
    await importEvalRuns(orgId, 'r1', 'openhands', [line]);
    await importEvalRuns(orgId, 'r1', 'openhands', [{ ...line, score: { ...line.score, accepted: false } }]);
    const rows = await listEngineRuns(orgId, { source: 'eval' });

    expect(rows.map(r => r.outcome)).toEqual(['qa_failed']);
    expect(scoreboardOf(rows)[0]).toMatchObject({ engine: 'openhands', source: 'eval', runs: 1, qaFailed: 1 });
  });
});
