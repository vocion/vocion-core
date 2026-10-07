/**
 * The repo family's reads: the four reads for any agent with a code-host
 * source in scope, the two pipeline reads granted-only by either
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
  readFile: vi.fn(async (_o: string, repo: string, path: string, ref: string | null) => {
    if (path === 'CLAUDE.md') {
      throw new Error(`${repo}/${path} @ ${ref} could not be read: HTTP 404`);
    }
    const text = path === 'README.md' ? 'R'.repeat(1200) : 'hello';
    return { repo, path, ref, size: text.length, text, truncated: false };
  }),
  readTree: vi.fn(async (_o: string, repo: string, ref: string | null) => ({
    repo,
    ref: ref ?? 'main',
    truncated: false,
    entries: [
      { path: 'README.md', type: 'blob' as const, size: 1200 },
      { path: 'CLAUDE.md', type: 'blob' as const, size: 5 },
      { path: 'package.json', type: 'blob' as const, size: 5 },
      { path: 'Dockerfile', type: 'blob' as const, size: 5 },
      { path: 'src', type: 'tree' as const },
      { path: 'src/report.ts', type: 'blob' as const, size: 10 },
      { path: 'infra', type: 'tree' as const },
      { path: 'infra/main.tf', type: 'blob' as const, size: 10 },
      { path: 'node_modules/left-pad/index.js', type: 'blob' as const, size: 10 },
    ],
  })),
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
    expect(names(ctxFor({ sources: ['github'] }))).toEqual(['repo_read_pull', 'repo_read_diff', 'repo_read_file', 'repo_read_tree']);
    expect(names(ctxFor({ sources: ['noco-code'], kinds: { 'noco-code': 'github' } }))).toEqual(['repo_read_pull', 'repo_read_diff', 'repo_read_file', 'repo_read_tree']);
    expect(names(ctxFor({ sources: ['hubspot'] }))).toEqual([]);
    expect(names(ctxFor({ sources: ['github'], allowed: ['jira'] }))).toEqual([]);
  });

  it('the tree read is also granted by name, so a seat with no source of its own can map a repository', () => {
    expect(names(ctxFor({ grants: ['repo_read_tree'] }))).toEqual(['repo_read_tree']);
    expect(names(ctxFor({ sources: ['github'], grants: ['repo_read_tree'] }))).toEqual(['repo_read_pull', 'repo_read_diff', 'repo_read_file', 'repo_read_tree']);
  });

  it('the pipeline reads are there only when granted, by their name or their former name', () => {
    expect(names(ctxFor({ grants: ['repo_read_pipeline_runs'] }))).toEqual(['repo_read_pipeline_runs']);
    expect(names(ctxFor({ grants: ['github_read_check_logs', 'github_read_workflow_runs'] }))).toEqual(['repo_read_check_logs', 'repo_read_pipeline_runs']);
    expect(names(ctxFor({ sources: ['github'], grants: ['repo_read_check_logs'] }))).toEqual(['repo_read_pull', 'repo_read_diff', 'repo_read_file', 'repo_read_tree', 'repo_read_check_logs']);
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

  it('repo_read_tree reads the tree once, summarises it, and reads the manifests at the same ref inside one budget', async () => {
    const out = JSON.parse(await toolNamed(ctx, 'repo_read_tree').invoke({ repo: 'Acme/northwind-core', maxManifestChars: 1000 }));

    expect(provider.readTree).toHaveBeenLastCalledWith('org_1', 'Acme/northwind-core', null);
    expect(out).toMatchObject({ ok: true, host: 'GitHub', repo: 'Acme/northwind-core', ref: 'main', truncated: false, fileCount: 6, directoryCount: 2 });
    expect(out.topLevel.map((t: { path: string }) => t.path)).toEqual(['infra/', 'src/', 'CLAUDE.md', 'Dockerfile', 'README.md', 'package.json']);
    expect(out.excluded).toEqual({ files: 1, directories: ['node_modules'], lockfiles: [] });
    expect(out.manifests.map((m: { path: string; kind: string }) => [m.path, m.kind])).toEqual([['README.md', 'readme'], ['package.json', 'package'], ['CLAUDE.md', 'agent-notes'], ['Dockerfile', 'container'], ['infra', 'deploy']]);
    // Every manifest file is read at the ref the tree came from, in reading order; the folder is named, not read.
    expect(provider.readFile.mock.calls.slice(-4).map(c => [c[2], c[3]])).toEqual([['README.md', 'main'], ['package.json', 'main'], ['CLAUDE.md', 'main'], ['Dockerfile', 'main']]);
    expect(out.manifestFiles.map((f: { path: string; truncated: boolean; kind: string }) => [f.path, f.truncated, f.kind])).toEqual([['README.md', true, 'readme'], ['package.json', false, 'package'], ['Dockerfile', false, 'container']]);
    expect(out.manifestFiles.reduce((n: number, f: { text: string }) => n + f.text.length, 0)).toBeLessThanOrEqual(1000);
    expect(out.manifestsSkipped).toEqual([
      { path: 'infra', reason: expect.stringContaining('a folder') },
      { path: 'CLAUDE.md', reason: expect.stringContaining('HTTP 404') },
    ]);
    expect(out.note).toMatch(/README\.md.*repo_read_file at ref main/);

    const bare = JSON.parse(await toolNamed(ctx, 'repo_read_tree').invoke({ repo: 'Acme/northwind-core', ref: 'factory/41', manifests: false }));

    expect(provider.readTree).toHaveBeenLastCalledWith('org_1', 'Acme/northwind-core', 'factory/41');
    expect(bare).toMatchObject({ ok: true, ref: 'factory/41', manifestFiles: [], manifestsSkipped: [] });
    expect(bare.note).toMatch(/manifests: false/);
  });

  it('repo_read_tree returns a host refusal as a value', async () => {
    provider.readTree.mockRejectedValueOnce(new Error('the tree of Acme/northwind-core @ gone could not be read: HTTP 404'));

    expect(JSON.parse(await toolNamed(ctx, 'repo_read_tree').invoke({ repo: 'Acme/northwind-core', ref: 'gone' }))).toEqual({ ok: false, error: expect.stringContaining('HTTP 404') });
  });

  it('repo_read_pipeline_runs names each run\'s jobs and the step that failed, and points at the family\'s actions', async () => {
    const out = JSON.parse(await toolNamed(ctxFor({ grants: ['repo_read_pipeline_runs'] }), 'repo_read_pipeline_runs').invoke({ repo: 'Acme/northwind-core', workflow: '.github/workflows/deploy.yml', branch: 'main' }));

    expect(listWorkflowRuns).toHaveBeenCalledWith('org_1', 'Acme/northwind-core', { workflow: '.github/workflows/deploy.yml', branch: 'main', limit: 5 });
    expect(out).toMatchObject({ ok: true, runs: [{ id: 36001, jobs: [{ name: 'deploy', failedStep: 'Web app', ran: ['npm ci'] }] }] });
    expect(out.note).toMatch(/repo\.rerun_failed_checks.*repo\.dispatch_pipeline.*repo\.cancel_pipeline_run/);
    expect(out.note).not.toMatch(/github\./);
  });
});
