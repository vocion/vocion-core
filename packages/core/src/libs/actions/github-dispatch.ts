/**
 * `github.dispatch_workflow` — A DEPLOY THAT SHOULD HAVE RUN, STARTED (backlog
 * 049; Chris, 2026-09-30: "start one with workflow_dispatch when a deploy
 * should happen and didn't"). A merge landed on the deploy branch and no run
 * of its deploy workflow followed — a webhook GitHub dropped, a concurrency
 * group that swallowed it — or an environment is down and redeploying what is
 * already merged is the next move of its recovery. The merge was the decision;
 * starting its deploy again is the pipeline's own move, done for you, and Undo
 * cancels the run while it is still running.
 *
 * Only a person, or a seat whose harness grants it, may start one
 * (`github-pull.mayActOnPipeline`), like every pipeline move.
 */

import type { Action } from './types';
import { z } from 'zod';
import { mayActOnPipeline } from './github-pull';

export const DISPATCH_WORKFLOW_ACTION_ID = 'github.dispatch_workflow';

const dispatchInput = z.object({
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'the repository as owner/name').describe('The repository, owner/name.'),
  workflow: z.string().min(1).max(300).describe('The workflow file, e.g. .github/workflows/deploy.yml (it must declare workflow_dispatch).'),
  ref: z.string().min(1).max(200).describe('The branch to run it on, e.g. main.'),
  inputs: z.record(z.string(), z.string()).optional().describe('The workflow\'s own inputs, as strings.'),
  sha: z.string().regex(/^[0-9a-f]{7,40}$/i).optional().describe('The commit this run is for (the branch head it should deploy); one start per commit.'),
  recordId: z.coerce.number().int().positive().optional().describe('The environment (or request) this run answers, so its page shows the run.'),
  reason: z.string().min(8).max(500).describe('Why it runs now: the deploy that did not run, or the recovery step it is.'),
});

type DispatchInput = z.infer<typeof dispatchInput>;

export const githubDispatchWorkflowAction: Action<typeof dispatchInput> = {
  id: DISPATCH_WORKFLOW_ACTION_ID,
  name: 'Start a workflow',
  description: 'Start a GitHub Actions workflow on a branch (workflow_dispatch) with the workspace\'s GitHub token — a deploy that should have run after a merge and did not, or a redeploy of what is already merged. Undo cancels the run while it is still running.',
  inputSchema: dispatchInput,
  grant: 'factory_write',
  external: true,
  // One start per workflow, branch and commit.
  dedupKeyFor: input => `${DISPATCH_WORKFLOW_ACTION_ID}:${input.repo}:${input.workflow}:${input.ref}${input.sha ? `@${input.sha.slice(0, 12)}` : ''}`,
  ownsDedupKey: true,
  async precheck(ctx) {
    const may = await mayActOnPipeline(ctx.orgId, ctx.invokedBy, DISPATCH_WORKFLOW_ACTION_ID);
    return may.ok ? undefined : may.why;
  },
  async reviewCard(_ctx, raw) {
    const input = raw as DispatchInput;
    return {
      title: `Start ${input.workflow} on ${input.repo}@${input.ref}`,
      system: 'GitHub',
      headline: 'Run the workflow now; Undo cancels it while it runs.',
      badges: [{ label: 'GitHub Actions' }, { label: 'Undo cancels the run' }],
      fields: [
        { label: 'Repository', value: input.repo, href: `https://github.com/${input.repo}/actions` },
        { label: 'Branch', value: input.ref },
        ...(input.sha ? [{ label: 'Commit', value: input.sha.slice(0, 12) }] : []),
        { label: 'Why now', value: input.reason },
      ],
      nextAction: 'Approving starts the workflow now.',
      verbs: { approve: 'Start it', reject: 'Leave it' },
    };
  },
  async execute(ctx, input) {
    const { dispatchWorkflow } = await import('@/services/factory/githubChecks');
    const out = await dispatchWorkflow(ctx.orgId, { repo: input.repo, workflow: input.workflow, ref: input.ref, inputs: input.inputs });
    const run = out.run ? `run #${out.run.runNumber}` : 'its run';
    const line = `Started ${input.workflow.split('/').pop()} on ${input.ref}${input.sha ? ` for ${input.sha.slice(0, 7)}` : ''} (${run}): ${input.reason}`;
    if (input.recordId) {
      const { noteOnRecord } = await import('@/services/factory/environments');
      await noteOnRecord(ctx.orgId, input.recordId, line, { runId: ctx.runId ?? null, url: out.run?.url ?? null }).catch(() => undefined);
    }
    return { dispatched: true, repo: out.repo, workflow: out.workflow, ref: out.ref, dispatchedAt: out.dispatchedAt, runId: out.run?.id ?? null, runUrl: out.run?.url ?? null, ...(input.recordId ? { objectId: input.recordId } : {}), line };
  },
  async undo(ctx, input, result) {
    const gh = await import('@/services/factory/githubChecks');
    let runId = Number(result?.runId) || null;
    if (!runId && typeof result?.dispatchedAt === 'string') {
      const runs = await gh.listWorkflowRuns(ctx.orgId, input.repo, { workflow: input.workflow, branch: input.ref, event: 'workflow_dispatch', limit: 5 }).catch(() => []);
      runId = runs.find(r => r.createdAt && Date.parse(r.createdAt) >= Date.parse(result.dispatchedAt as string) - 5_000)?.id ?? null;
    }
    if (!runId) {
      return { cancelled: [], note: 'No run of this start was found, so there was nothing to cancel.' };
    }
    const out = await gh.cancelWorkflowRuns(ctx.orgId, input.repo, [runId]);
    return { ...out, note: out.finished.length > 0 ? 'The run had already finished; it stays as it ended.' : 'The run was cancelled.' };
  },
};
