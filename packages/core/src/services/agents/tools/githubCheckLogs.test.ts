/**
 * The pipeline's reads are granted-only, each by its own name (backlog 049):
 * the check logs, and a repository's deploys and CI runs with their jobs.
 * GitHub is mocked; the repository is invented.
 */
import type { RuntimeContext } from '../types';
import { describe, expect, it, vi } from 'vitest';

const listWorkflowRuns = vi.fn(async () => [{ id: 36001, name: 'Deploy', headSha: 'c0ffee', conclusion: 'failure', url: 'https://github.com/Acme/northwind-core/actions/runs/36001' }]);
const runJobs = vi.fn(async () => [{ name: 'deploy', conclusion: 'failure', failedStep: 'Web app', steps: [{ name: 'npm ci', conclusion: 'success' }, { name: 'Web app', conclusion: 'failure' }] }]);
vi.mock('@/services/factory/githubChecks', () => ({ listWorkflowRuns, runJobs }));

const { githubCheckLogsTools } = await import('./githubCheckLogs');

function ctxFor(grants: string[]): RuntimeContext {
  return { orgId: 'org_1', userId: 'u', agentSlug: 'release-engineer', connectorSources: [], objectTypeSlugs: [], searchConfig: {}, harnessConfig: { grantTools: grants }, emit: () => {}, citationSeq: { current: 0 } } as RuntimeContext;
}

type Invokable = { name: string; invoke: (input: Record<string, unknown>) => Promise<string> };

describe('the pipeline reads', () => {
  it('are there only when granted, each by its name', () => {
    expect(githubCheckLogsTools(ctxFor([]))).toHaveLength(0);
    expect((githubCheckLogsTools(ctxFor(['github_read_workflow_runs'])) as unknown as Invokable[]).map(t => t.name)).toEqual(['github_read_workflow_runs']);
    expect((githubCheckLogsTools(ctxFor(['github_read_check_logs', 'github_read_workflow_runs'])) as unknown as Invokable[]).map(t => t.name)).toEqual(['github_read_check_logs', 'github_read_workflow_runs']);
  });

  it('github_read_workflow_runs names each run\'s jobs and the step that failed', async () => {
    const [t] = githubCheckLogsTools(ctxFor(['github_read_workflow_runs'])) as unknown as Invokable[];
    const out = JSON.parse(await t!.invoke({ repo: 'Acme/northwind-core', workflow: '.github/workflows/deploy.yml', branch: 'main' }));

    expect(listWorkflowRuns).toHaveBeenCalledWith('org_1', 'Acme/northwind-core', { workflow: '.github/workflows/deploy.yml', branch: 'main', limit: 5 });
    expect(out).toMatchObject({ ok: true, runs: [{ id: 36001, jobs: [{ name: 'deploy', failedStep: 'Web app', ran: ['npm ci'] }] }] });
  });
});
