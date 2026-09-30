/**
 * `github.dispatch_workflow` (backlog 049): a deploy that should have run is
 * started by the pipeline's owner, done for you, and Undo cancels the run.
 * GitHub is mocked; the repository is invented.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const dispatchWorkflow = vi.fn(async (_orgId: string, o: { repo: string; workflow: string; ref: string }) => ({ repo: o.repo, workflow: o.workflow, ref: o.ref, dispatchedAt: '2026-09-30T12:00:00Z', run: { id: 7001, runNumber: 52, url: 'https://github.com/Acme/northwind-core/actions/runs/7001' } }));
const cancelWorkflowRuns = vi.fn(async () => ({ cancelled: [7001], finished: [] }));
const listWorkflowRuns = vi.fn(async () => []);
vi.mock('@/services/factory/githubChecks', () => ({ dispatchWorkflow, cancelWorkflowRuns, listWorkflowRuns }));

const { db } = await import('@/libs/DB');
const { agentSchema } = await import('@/models/Schema');
const { githubDispatchWorkflowAction: action } = await import('./github-dispatch');

const ORG = 'org_dispatch';
const input = { repo: 'Acme/northwind-core', workflow: '.github/workflows/deploy.yml', ref: 'main', sha: 'feed0000abcd', reason: 'main took feed000 25 min ago and deploy.yml never ran for it.' };

beforeAll(async () => {
  await db.insert(agentSchema).values([
    { orgId: ORG, slug: 'release-engineer', name: 'Release engineer', systemPrompt: 'x', harnessConfig: { grantTools: ['github.dispatch_workflow'] } },
    { orgId: ORG, slug: 'product-manager', name: 'PM', systemPrompt: 'x', harnessConfig: {} },
  ] as never);
});

describe('github.dispatch_workflow', () => {
  it('is the pipeline owner\'s move, or a person\'s', async () => {
    expect(await action.precheck!({ orgId: ORG, invokedBy: 'agent:release-engineer' }, input)).toBeUndefined();
    expect(await action.precheck!({ orgId: ORG, invokedBy: 'user_kestrel_1' }, input)).toBeUndefined();
    expect(await action.precheck!({ orgId: ORG, invokedBy: 'agent:product-manager' }, input)).toContain('the seat that owns the pipeline (release-engineer)');
  });

  it('starts the workflow and names the run it started', async () => {
    const out = await action.execute({ orgId: ORG }, input);

    expect(dispatchWorkflow).toHaveBeenCalledWith(ORG, { repo: input.repo, workflow: input.workflow, ref: 'main', inputs: undefined });
    expect(out).toMatchObject({ dispatched: true, runId: 7001, runUrl: 'https://github.com/Acme/northwind-core/actions/runs/7001', line: expect.stringContaining('Started deploy.yml on main for feed000 (run #52)') });
  });

  it('is undone by cancelling its run, and is one start per commit', async () => {
    expect(await action.undo!({ orgId: ORG }, input, { runId: 7001 })).toMatchObject({ cancelled: [7001], note: 'The run was cancelled.' });
    expect(cancelWorkflowRuns).toHaveBeenCalledWith(ORG, input.repo, [7001]);
    expect(action.dedupKeyFor!(input)).toBe(action.dedupKeyFor!({ ...input, reason: 'another reason, same commit' }));
    expect(action.dedupKeyFor!(input)).not.toBe(action.dedupKeyFor!({ ...input, sha: 'feed0000ffff' }));
  });
});
