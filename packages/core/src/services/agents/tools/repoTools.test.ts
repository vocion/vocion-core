/**
 * The repo family's reads: the three pull-request reads for any agent with a
 * code-host source in scope, the two pipeline reads granted-only by either
 * their name or their former name (backlog 049). The host is mocked at the
 * provider seam; the repository is invented.
 */
import type { RuntimeContext } from '../types';
import { describe, expect, it, vi } from 'vitest';

const provider = {
  kind: 'github' as const,
  label: 'GitHub',
  parsePullRef: (url: string) => (url.includes('/pull/7') ? { repo: 'Acme/northwind-core', number: 7, url: 'https://github.com/Acme/northwind-core/pull/7' } : null),
  parseRunRef: () => null,
  pullUrl: (repo: string, n: number) => `https://github.com/${repo}/pull/${n}`,
  readPull: vi.fn(async () => ({ title: 'Fix the report', headSha: 'abc123', files: [{ path: 'src/report.ts' }] })),
  readPullDiff: vi.fn(async () => 'diff --git a/src/report.ts b/src/report.ts\n@@\ndiff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml\n@@\n'),
  readCompareDiff: vi.fn(async () => 'diff --git a/README.md b/README.md\n@@\n'),
  readFile: vi.fn(async (_o: string, repo: string, path: string, ref: string | null) => ({ repo, path, ref, size: 5, text: 'hello', truncated: false })),
};
vi.mock('@/services/repo/provider', async () => {
  const actual = await vi.importActual<typeof import('@/services/repo/provider')>('@/services/repo/provider');
  return { ...actual, repoProviderFor: vi.fn(async () => provider) };
});
const readRecord = vi.fn(async (_o: string, id: number) => (id === 41 ? { id: 41, title: 't', typeId: 1, status: 'open', typeSlug: 'engineering_task', meta: { allowedPaths: ['src/**'] } } : null));
vi.mock('@/libs/actions/factory-dispatch', () => ({ readRecord }));

const listWorkflowRuns = vi.fn(async () => [{ id: 36001, name: 'Deploy', headSha: 'c0ffee', conclusion: 'failure', url: 'https://github.com/Acme/northwind-core/actions/runs/36001' }]);
const runJobs = vi.fn(async () => [{ name: 'deploy', conclusion: 'failure', failedStep: 'Web app', steps: [{ name: 'npm ci', conclusion: 'success' }, { name: 'Web app', conclusion: 'failure' }] }]);
vi.mock('@/services/factory/githubChecks', () => ({ listWorkflowRuns, runJobs }));

const { repoTools } = await import('./repoTools');

function ctxFor(o: { grants?: string[]; sources?: string[]; kinds?: Record<string, string>; allowed?: string[] } = {}): RuntimeContext {
  return { orgId: 'org_1', userId: 'u', agentSlug: 'release-engineer', connectorSources: o.sources ?? [], sourceKinds: o.kinds, allowedSourceSlugs: o.allowed, objectTypeSlugs: [], searchConfig: {}, harnessConfig: { grantTools: o.grants ?? [] }, emit: () => {}, citationSeq: { current: 0 } } as RuntimeContext;
}

type Invokable = { name: string; invoke: (input: Record<string, unknown>) => Promise<string> };
const names = (ctx: RuntimeContext) => (repoTools(ctx) as unknown as Invokable[]).map(t => t.name);
const toolNamed = (ctx: RuntimeContext, name: string) => (repoTools(ctx) as unknown as Invokable[]).find(t => t.name === name)!;

describe('which repo tools a turn has', () => {
  it('the three reads need a code-host source in scope; a source of another kind, or one the person\'s ACL excludes, gives none', () => {
    expect(names(ctxFor())).toEqual([]);
    expect(names(ctxFor({ sources: ['github'] }))).toEqual(['repo_read_pull', 'repo_read_diff', 'repo_read_file']);
    expect(names(ctxFor({ sources: ['noco-code'], kinds: { 'noco-code': 'github' } }))).toEqual(['repo_read_pull', 'repo_read_diff', 'repo_read_file']);
    expect(names(ctxFor({ sources: ['hubspot'] }))).toEqual([]);
    expect(names(ctxFor({ sources: ['github'], allowed: ['jira'] }))).toEqual([]);
  });

  it('the pipeline reads are there only when granted, by their name or their former name', () => {
    expect(names(ctxFor({ grants: ['repo_read_pipeline_runs'] }))).toEqual(['repo_read_pipeline_runs']);
    expect(names(ctxFor({ grants: ['github_read_check_logs', 'github_read_workflow_runs'] }))).toEqual(['repo_read_check_logs', 'repo_read_pipeline_runs']);
    expect(names(ctxFor({ sources: ['github'], grants: ['repo_read_check_logs'] }))).toEqual(['repo_read_pull', 'repo_read_diff', 'repo_read_file', 'repo_read_check_logs']);
  });
});

describe('the reads', () => {
  const ctx = ctxFor({ sources: ['github'] });

  it('repo_read_pull reads one pull request by URL or by repo and number, through the provider', async () => {
    const out = JSON.parse(await toolNamed(ctx, 'repo_read_pull').invoke({ url: 'https://github.com/Acme/northwind-core/pull/7' }));

    expect(out).toMatchObject({ ok: true, host: 'GitHub', pull: { title: 'Fix the report' } });

    await toolNamed(ctx, 'repo_read_pull').invoke({ repo: 'Acme/northwind-core', number: 7 });

    expect(provider.readPull).toHaveBeenLastCalledWith('org_1', { repo: 'Acme/northwind-core', number: 7, url: 'https://github.com/Acme/northwind-core/pull/7' });
    expect(JSON.parse(await toolNamed(ctx, 'repo_read_pull').invoke({ url: 'https://github.com/Acme/northwind-core' }))).toMatchObject({ ok: false, error: expect.stringContaining('not a pull request URL') });
  });

  it('repo_read_diff lists the files, and with a task names the ones outside its allowed paths', async () => {
    const out = JSON.parse(await toolNamed(ctx, 'repo_read_diff').invoke({ url: 'https://github.com/Acme/northwind-core/pull/7', task_id: 41 }));

    expect(out).toMatchObject({ ok: true, files: ['src/report.ts', '.github/workflows/ci.yml'], allowedPaths: ['src/**'], outsideAllowedPaths: ['.github/workflows/ci.yml'] });
    expect(out.note).toMatch(/1 file\(s\) fall outside task #41/);

    const compare = JSON.parse(await toolNamed(ctx, 'repo_read_diff').invoke({ repo: 'Acme/northwind-core', base: 'main', head: 'factory/41' }));

    expect(compare).toMatchObject({ ok: true, about: 'Acme/northwind-core main...factory/41', files: ['README.md'] });
    expect(compare.outsideAllowedPaths).toBeUndefined();
    expect(JSON.parse(await toolNamed(ctx, 'repo_read_diff').invoke({ url: 'https://github.com/Acme/northwind-core/pull/7', task_id: 99 }))).toMatchObject({ ok: false, error: 'No record #99 in this workspace.' });
  });

  it('repo_read_file reads a file at a ref through the provider', async () => {
    const out = JSON.parse(await toolNamed(ctx, 'repo_read_file').invoke({ repo: 'Acme/northwind-core', path: '.github/workflows/ci.yml', ref: 'main' }));

    expect(out).toMatchObject({ ok: true, host: 'GitHub', path: '.github/workflows/ci.yml', ref: 'main', text: 'hello' });
  });

  it('repo_read_pipeline_runs names each run\'s jobs and the step that failed, and points at the family\'s actions', async () => {
    const out = JSON.parse(await toolNamed(ctxFor({ grants: ['repo_read_pipeline_runs'] }), 'repo_read_pipeline_runs').invoke({ repo: 'Acme/northwind-core', workflow: '.github/workflows/deploy.yml', branch: 'main' }));

    expect(listWorkflowRuns).toHaveBeenCalledWith('org_1', 'Acme/northwind-core', { workflow: '.github/workflows/deploy.yml', branch: 'main', limit: 5 });
    expect(out).toMatchObject({ ok: true, runs: [{ id: 36001, jobs: [{ name: 'deploy', failedStep: 'Web app', ran: ['npm ci'] }] }] });
    expect(out.note).toMatch(/repo\.rerun_failed_checks.*repo\.dispatch_pipeline.*repo\.cancel_pipeline_run/);
    expect(out.note).not.toMatch(/github\./);
  });
});
