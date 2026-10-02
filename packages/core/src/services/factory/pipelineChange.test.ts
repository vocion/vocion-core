/**
 * The pipeline's owner fixes the pipeline itself (backlog 049), against
 * PGlite: who may open a pipeline change, the change merged on green and sent
 * back red, and the stop that goes to a person once when the owner's moves run
 * out. GitHub is injected or faked; every name, repo and path is invented.
 */
import type { GithubCheckRun, GithubPullRequest } from '@/libs/github/events';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const openChangePull = vi.fn(async (_orgId: string, o: { repo: string; title: string; branch?: string | null }) => ({ repo: o.repo, url: 'https://github.com/Acme/northwind-core/pull/501', number: 501, branch: o.branch ?? 'vocion/pipeline-202609301200-ci-fix', base: 'main', headSha: 'c0ffee000001', created: !o.branch, paths: ['.github/workflows/ci.yml'] }));
vi.mock('./githubChange', async importOriginal => ({ ...(await importOriginal<typeof import('./githubChange')>()), openChangePull }));

const { db } = await import('@/libs/DB');
const { actionRunSchema, agentSchema, askSchema, automationRunSchema, businessObjectSchema, eventLogSchema, trustRuleSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { and, eq } = await import('drizzle-orm');
const { githubOpenPullAction, mayOpenPipelinePull } = await import('@/libs/actions/github-pull');
const { proposeAction } = await import('@/services/ActionService');
const { pipelineFixEnded, raisePipelineFix, reconcileChanges } = await import('./pipelineChange');

const ORG = 'org_pipeline_change';
const REPO = 'Acme/northwind-core';
const OWNER = 'release-engineer';
const types: Record<string, number> = {};

beforeAll(async () => {
  for (const slug of ['request', 'environment']) {
    const [t] = await createObjectType({ slug, label: slug }, ORG);
    types[slug] = t!.id;
  }
  await db.insert(agentSchema).values([
    { orgId: ORG, slug: OWNER, name: 'Release engineer', systemPrompt: 'x', harnessConfig: { grantTools: ['github_read_check_logs', 'repo.open_pull'] } },
    { orgId: ORG, slug: 'task-engineer', name: 'Engineer', systemPrompt: 'x', harnessConfig: { runsOn: 'external-worker' } },
  ] as never);
  await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: 'repo.open_pull', threshold: 0.8, enabled: 'true' });
});

async function aFix(title: string) {
  const [r] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.request!, title, metadata: { kind: 'incident', state: 'new', pipelineFix: { repo: REPO, branch: 'main', fixIn: 'pipeline', blocks: [] } } }).returning();
  return r!;
}

async function read(id: number) {
  const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, id));
  return row!;
}

function log(meta: unknown): string[] {
  return (((meta as { recovery?: { log?: Array<{ text: string }> } }).recovery?.log) ?? []).map(l => l.text);
}

const INPUT = { repo: REPO, title: 'CI: give the e2e job its database', body: 'The e2e job fails: connect ECONNREFUSED on the database port. The job has no service.', files: [{ path: '.github/workflows/ci.yml', content: 'name: CI\n' }] };

describe('who may open a pipeline change', () => {
  it('the seat whose harness grants it, or a person; never the engineer\'s worker', async () => {
    expect(await mayOpenPipelinePull(ORG, `agent:${OWNER}`)).toEqual({ ok: true });
    expect(await mayOpenPipelinePull(ORG, 'user_northwind_1')).toEqual({ ok: true });

    const engineer = await mayOpenPipelinePull(ORG, 'agent:task-engineer');

    expect(engineer.ok).toBe(false);
    expect(!engineer.ok && engineer.why).toContain(`the seat that owns the pipeline (${OWNER})`);
    expect((await mayOpenPipelinePull(ORG, 'token:42')).ok).toBe(false);
  });

  it('refuses the proposal itself, before anything reaches GitHub', async () => {
    await expect(proposeAction({ orgId: ORG, actionId: 'repo.open_pull', input: INPUT, principal: { kind: 'agent', id: 'agent:task-engineer', scope: { orgId: ORG }, grants: ['*'], autonomy: 2 }, invokedBy: 'agent:task-engineer', proposal: { confidence: 0.95 } } as never))
      .rejects
      .toThrow(/seat that owns the pipeline/);
    expect(openChangePull).not.toHaveBeenCalled();
  });

  it('done for you for its owner: opened, and written on the record it answers', async () => {
    const fix = await aFix('main is red on Acme/northwind-core: e2e');

    const res = await proposeAction({ orgId: ORG, actionId: 'repo.open_pull', input: { ...INPUT, recordId: fix.id }, principal: { kind: 'agent', id: `agent:${OWNER}`, scope: { orgId: ORG }, grants: ['*'], autonomy: 2 }, invokedBy: `agent:${OWNER}`, proposal: { confidence: 0.9 } } as never) as { status: string; runId: number };

    expect(res.status).toBe('done');
    expect((await read(fix.id)).metadata).toMatchObject({ pipelineChange: { url: 'https://github.com/Acme/northwind-core/pull/501', state: 'open', riskClass: 'pipeline', branch: 'vocion/pipeline-202609301200-ci-fix', by: `agent:${OWNER}`, actionRunId: res.runId } });
    expect(log((await read(fix.id)).metadata).some(l => l.startsWith('Opened Acme/northwind-core/pull/501 (.github/workflows/ci.yml)'))).toBe(true);

    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, res.runId));

    expect(run!.result).toMatchObject({ opened: true, objectId: fix.id });
  });

  it('opened with no record named, it lands on the repository\'s own record, so it still merges itself (squatch-core #148)', async () => {
    const [repo] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.environment!, title: REPO, metadata: {} }).returning();

    const res = await proposeAction({ orgId: ORG, actionId: 'repo.open_pull', input: INPUT, principal: { kind: 'agent', id: `agent:${OWNER}`, scope: { orgId: ORG }, grants: ['*'], autonomy: 2 }, invokedBy: `agent:${OWNER}`, proposal: { confidence: 0.9 } } as never) as { status: string; runId: number };

    expect(res.status).toBe('done');
    expect((await read(repo!.id)).metadata).toMatchObject({ pipelineChange: { state: 'open', riskClass: 'pipeline' } });

    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, res.runId));

    expect(run!.result).toMatchObject({ opened: true, objectId: repo!.id });
    expect(String((run!.result as { line?: string }).line)).toMatch(/merges itself when its checks are green/);
  });

  it('undo closes the change, or reverts it once merged', async () => {
    const discard = vi.fn(async () => ({ closed: true, branchDeleted: true, revertUrl: null, state: 'closed' }));
    const mod = await import('./githubChange');
    const spy = vi.spyOn(mod, 'discardChange').mockImplementation(discard as never);
    const fix = await aFix('main is red on Acme/northwind-core: lint');

    const out = await githubOpenPullAction.undo!({ orgId: ORG }, { ...INPUT, recordId: fix.id }, { url: 'https://github.com/Acme/northwind-core/pull/501', branch: 'vocion/pipeline-202609301200-ci-fix' });

    expect(discard).toHaveBeenCalledWith(ORG, { url: 'https://github.com/Acme/northwind-core/pull/501', repo: REPO, branch: 'vocion/pipeline-202609301200-ci-fix' });
    expect(out).toMatchObject({ closed: true, note: 'The pull request is closed and its branch deleted.' });
    expect((await read(fix.id)).metadata).toMatchObject({ pipelineChange: { state: 'withdrawn' } });

    spy.mockRestore();
  });
});

const pull = (over: Partial<GithubPullRequest> = {}): GithubPullRequest => ({ number: 501, html_url: 'https://github.com/Acme/northwind-core/pull/501', title: 'CI: give the e2e job its database', state: 'open', draft: false, head: { ref: 'vocion/pipeline-202609301200-ci-fix', sha: 'c0ffee000001' }, base: { ref: 'main' }, user: { login: 'vocion' }, merged_at: null, merge_commit_sha: null, closed_at: null, updated_at: '2026-09-30T12:00:00Z', ...over } as GithubPullRequest);
const runs = (conclusion: string): GithubCheckRun[] => [{ id: 1, name: 'e2e', status: 'completed', conclusion } as GithubCheckRun, { id: 2, name: 'lint', status: 'completed', conclusion: 'success' } as GithubCheckRun];

async function withOpenChange(title: string, extra: Record<string, unknown> = {}) {
  const fix = await aFix(title);
  await db.update(businessObjectSchema).set({ metadata: { ...(fix.metadata as Record<string, unknown>), pipelineChange: { url: 'https://github.com/Acme/northwind-core/pull/501', repo: REPO, branch: 'vocion/pipeline-202609301200-ci-fix', base: 'main', headSha: 'c0ffee000001', title: 'CI: give the e2e job its database', riskClass: 'pipeline', state: 'open', openedAt: '2026-09-30T12:00:00Z', pushedAt: '2026-09-30T12:00:00Z', by: `agent:${OWNER}` }, ...extra } }).where(eq(businessObjectSchema.id, fix.id));
  return fix;
}

describe('a pipeline change is carried to its merge', () => {
  it('green: merged under git.merge.pipeline, once per head', async () => {
    const fix = await withOpenChange('main is red: e2e (green)');
    const proposeMerge = vi.fn(async () => ({ runId: 77, status: 'done' }));
    const deps = { readPull: async () => ({ repo: REPO, pr: pull(), checkRuns: runs('success') }), proposeMerge };

    const first = await reconcileChanges(ORG, new Date('2026-09-30T12:10:00Z'), OWNER, deps);
    await reconcileChanges(ORG, new Date('2026-09-30T12:15:00Z'), OWNER, deps);

    expect(first.find(r => r.requestId === fix.id)?.did).toBe('change green: merge done');
    expect(proposeMerge.mock.calls.filter(c => (c as unknown[])[1] && ((c as unknown[])[1] as { recordId: number }).recordId === fix.id)).toHaveLength(1);
    expect(proposeMerge).toHaveBeenCalledWith(ORG, expect.objectContaining({ url: 'https://github.com/Acme/northwind-core/pull/501', headSha: 'c0ffee000001', riskClass: 'pipeline', owner: OWNER, recordId: fix.id }));
    expect(log((await read(fix.id)).metadata).some(l => l.includes('it was merged (action #77, Undo opens the revert)'))).toBe(true);
  });

  it('a green pipeline change nothing tracks is adopted onto its repository record and merged (squatch-core #148)', async () => {
    const ORG2 = 'org_pipeline_adopt';
    const [t] = await createObjectType({ slug: 'repo', label: 'repo' }, ORG2);
    const [repo] = await db.insert(businessObjectSchema).values({ orgId: ORG2, typeId: t!.id, title: 'Acme/kestrel-web', metadata: { checks: [{ name: 'test', command: 'npm test' }] } }).returning();
    const url = 'https://github.com/Acme/kestrel-web/pull/148';
    const listPipelinePulls = vi.fn(async () => [{ url, branch: 'vocion/pipeline-202610011241-build-natively', base: 'main', headSha: 'c0ffee000148', title: 'fix(pipeline): build natively', createdAt: '2026-10-01T12:41:00Z' }]);
    const proposeMerge = vi.fn(async () => ({ runId: 88, status: 'done' }));
    const deps = { readPull: async () => ({ repo: 'Acme/kestrel-web', pr: pull({ html_url: url, head: { ref: 'vocion/pipeline-202610011241-build-natively', sha: 'c0ffee000148' } }), checkRuns: runs('success') }), proposeMerge, listPipelinePulls };

    const out = await reconcileChanges(ORG2, new Date('2026-10-01T13:00:00Z'), OWNER, deps as never);

    expect(out.some(r => r.requestId === repo!.id && r.did === 'adopted')).toBe(true);
    expect((await read(repo!.id)).metadata).toMatchObject({ pipelineChange: { url, state: expect.any(String) } });
    expect(proposeMerge).toHaveBeenCalledWith(ORG2, expect.objectContaining({ url, recordId: repo!.id }));

    // A second pass adopts nothing new.
    const again = await reconcileChanges(ORG2, new Date('2026-10-01T13:05:00Z'), OWNER, deps as never);

    expect(again.some(r => r.did === 'adopted')).toBe(false);
  });

  it('no checks yet on a fresh change: it waits', async () => {
    await withOpenChange('main is red: e2e (fresh)');
    const proposeMerge = vi.fn(async () => ({ runId: 1, status: 'done' }));

    await reconcileChanges(ORG, new Date('2026-09-30T12:05:00Z'), OWNER, { readPull: async () => ({ repo: REPO, pr: pull(), checkRuns: [] }), proposeMerge });

    expect(proposeMerge).not.toHaveBeenCalled();
  });

  it('merged: written down, and no longer read back', async () => {
    const fix = await withOpenChange('main is red: e2e (merged)');

    await reconcileChanges(ORG, new Date('2026-09-30T12:20:00Z'), OWNER, { readPull: async () => ({ repo: REPO, pr: pull({ state: 'closed', merged_at: '2026-09-30T12:18:00Z', merge_commit_sha: 'aa11bb22cc33' } as never), checkRuns: [] }), proposeMerge: vi.fn() });

    expect((await read(fix.id)).metadata).toMatchObject({ pipelineChange: { state: 'merged', mergeSha: 'aa11bb22cc33' } });
    expect(log((await read(fix.id)).metadata)).toContain('Acme/northwind-core/pull/501 merged at aa11bb2: the pipeline fix is in.');
  });

  it('red: back to its owner with the failing checks; after two attempts, one ask to a person and a needs-person stop', async () => {
    const fix = await withOpenChange('main is red: e2e (red)', { pipelineWork: { attempt: 1, raisedAt: '2026-09-30T11:50:00Z', cause: 'main_broken', why: 'main has no database for e2e', url: 'https://github.com/Acme/northwind-core/pull/400', owner: OWNER, requestId: null } });
    const red = (sha: string) => ({ readPull: async () => ({ repo: REPO, pr: pull({ head: { ref: 'vocion/pipeline-202609301200-ci-fix', sha } } as never), checkRuns: runs('failure') }), proposeMerge: vi.fn() });

    const second = await reconcileChanges(ORG, new Date('2026-09-30T12:10:00Z'), OWNER, red('c0ffee000001'));

    expect(second.find(r => r.requestId === fix.id)?.did).toBe('change red: asked again');

    const [raised] = await db.select().from(eventLogSchema).where(and(eq(eventLogSchema.orgId, ORG), eq(eventLogSchema.dedupeKey, `pipeline.needs_fix:${fix.id}:2`)));

    expect(raised!.payload).toMatchObject({ cause: 'change_failed', attempt: 2, changeUrl: 'https://github.com/Acme/northwind-core/pull/501', changeBranch: 'vocion/pipeline-202609301200-ci-fix', failing: 'e2e' });
    // The same red head read again does nothing.
    expect((await reconcileChanges(ORG, new Date('2026-09-30T12:15:00Z'), OWNER, red('c0ffee000001'))).find(r => r.requestId === fix.id)).toBeUndefined();

    // The owner's second commit is red too: that was its last attempt.
    const third = await reconcileChanges(ORG, new Date('2026-09-30T12:30:00Z'), OWNER, red('c0ffee000002'));

    expect(third.find(r => r.requestId === fix.id)?.did).toBe('change red: stopped');

    const asks = await db.select().from(askSchema).where(and(eq(askSchema.orgId, ORG), eq(askSchema.sourceRef, `pipeline-stop:${fix.id}:2`)));

    expect(asks).toHaveLength(1);
    expect(asks[0]!.options?.find(o => o.recommended)?.action).toMatchObject({ id: 'repo.rerun_failed_checks', input: { url: 'https://github.com/Acme/northwind-core/pull/501' } });
    expect((await read(fix.id)).metadata).toMatchObject({ recovery: { stage: 'stopped', askId: asks[0]!.id }, pipelineWork: { stoppedAt: expect.any(String), askId: asks[0]!.id } });

    const [stopped] = await db.select().from(eventLogSchema).where(and(eq(eventLogSchema.orgId, ORG), eq(eventLogSchema.type, 'factory.stopped'), eq(eventLogSchema.dedupeKey, `factory.stopped:${fix.id}:${asks[0]!.id}`)));

    expect(stopped!.payload).toMatchObject({ requestId: fix.id, askId: asks[0]!.id });
    expect(String((stopped!.payload as Record<string, unknown>).why)).toContain('Release engineer tried 2 times and it is still red');

    // Asked again past the limit: the stop that is already with a person answers it.
    const more = await raisePipelineFix(ORG, { recordId: fix.id, title: 'x', repo: REPO, branch: 'main', cause: 'change_failed', why: 'still red', failing: 'e2e', url: 'https://github.com/Acme/northwind-core/pull/501', owner: OWNER });

    expect(more).toMatchObject({ raised: false });
    expect(await db.select().from(askSchema).where(and(eq(askSchema.orgId, ORG), eq(askSchema.sourceRef, `pipeline-stop:${fix.id}:2`)))).toHaveLength(1);
  });
});

describe('a rollback an environment\'s recovery opened', () => {
  it('red: written on the environment, not sent back to be reworked', async () => {
    const [t] = await createObjectType({ slug: 'environment', label: 'environment' }, ORG).catch(() => [null]);
    const typeId = t?.id ?? types.environment!;
    const [env] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId, title: 'rooms-api-production', metadata: { slug: 'rooms-api-production', pipelineChange: { url: 'https://github.com/Acme/northwind-core/pull/501', riskClass: 'rollback', state: 'open', openedAt: '2026-09-30T12:00:00Z', pushedAt: '2026-09-30T12:00:00Z', noRework: true, by: `agent:${OWNER}` } } }).returning();

    const out = await reconcileChanges(ORG, new Date('2026-09-30T12:20:00Z'), OWNER, { readPull: async () => ({ repo: REPO, pr: pull({ head: { ref: 'revert-140-x', sha: 'rev000000001' } } as never), checkRuns: runs('failure') }), proposeMerge: vi.fn() });

    expect(out.find(r => r.requestId === env!.id)?.did).toBe('change red: noted');
    expect((await read(env!.id)).metadata).toMatchObject({ lastPipelineLine: expect.stringContaining('is red (e2e)'), pipelineChange: { failedSha: 'rev000000001' } });
    expect((await read(env!.id)).metadata).not.toHaveProperty('pipelineWork');
  });
});

describe('the owner\'s fix run is read back when it ends', () => {
  async function aRun(recordId: number, startedAt: Date) {
    const [run] = await db.insert(automationRunSchema).values({ orgId: ORG, slug: 'pipeline-fix', kind: 'mission_check', status: 'ok', input: { recordId }, startedAt, result: { summary: 'The runner lost its Docker socket; a person must restart it.' } }).returning();
    return run!;
  }

  it('a move on the action rail means it acted', async () => {
    const fix = await aFix('main is red: e2e (acted)');
    await raisePipelineFix(ORG, { recordId: fix.id, title: fix.title, repo: REPO, branch: 'main', cause: 'main_broken', why: 'main has no database for e2e', failing: 'e2e', url: 'https://github.com/Acme/northwind-core/pull/402', owner: OWNER });
    const run = await aRun(fix.id, new Date(Date.now() - 60_000));
    await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'repo.open_pull', status: 'done', input: { ...INPUT, recordId: fix.id }, invokedBy: `agent:${OWNER}` } as never);

    const out = await pipelineFixEnded(ORG, { automationRunId: run.id, owner: OWNER });

    expect(out.did).toBe('acted');
  });

  it('no move: stopped once, with what the run said', async () => {
    const fix = await aFix('main is red: e2e (no move)');
    await raisePipelineFix(ORG, { recordId: fix.id, title: fix.title, repo: REPO, branch: 'main', cause: 'infra', why: 'the runner could not start the job', failing: 'e2e', url: 'https://github.com/Acme/northwind-core/actions/runs/9100', owner: OWNER });
    const run = await aRun(fix.id, new Date(Date.now() + 1_000));

    const out = await pipelineFixEnded(ORG, { automationRunId: run.id, owner: OWNER });

    expect(out.did).toBe('stopped');
    expect(out.line).toContain('Release engineer\'s pass on it ended without a fix (The runner lost its Docker socket; a person must restart it.)');

    const asks = await db.select().from(askSchema).where(and(eq(askSchema.orgId, ORG), eq(askSchema.sourceRef, `pipeline-stop:${fix.id}:1`)));

    expect(asks).toHaveLength(1);
    expect(asks[0]!.options?.find(o => o.recommended)?.action).toMatchObject({ id: 'repo.rerun_failed_checks', input: { url: 'https://github.com/Acme/northwind-core/actions/runs/9100' } });
    // Ending again says nothing new: the stop is already with a person.
    expect((await pipelineFixEnded(ORG, { automationRunId: run.id, owner: OWNER })).did).toBe('nothing waits');
  });

  it('a run that failed is read back too, with its error as the reason', async () => {
    const fix = await aFix('main is red: e2e (run failed)');
    await raisePipelineFix(ORG, { recordId: fix.id, title: fix.title, repo: REPO, branch: 'main', cause: 'main_broken', why: 'the workflow names a runner label that no longer exists', failing: 'e2e', url: 'https://github.com/Acme/northwind-core/pull/403', owner: OWNER });
    const run = await aRun(fix.id, new Date(Date.now() + 1_000));

    const out = await pipelineFixEnded(ORG, { automationRunId: run.id, owner: OWNER, error: 'the model call timed out' });

    expect(out.did).toBe('stopped');
    expect(out.line).toContain('(the run failed: the model call timed out)');
  });
});
