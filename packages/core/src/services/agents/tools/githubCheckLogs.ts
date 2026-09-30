/**
 * github_read_check_logs — what CI said on a pull request (or one Actions
 * run), read with the workspace's own GitHub token: each failing check, its
 * annotations, the failing step and the tail of that step's log, and the
 * files the pull request changes. For the seat that owns the pipeline
 * (backlog 049); granted-only (`harness.grantTools: [github_read_check_logs]`).
 * Beside it, `github_read_workflow_runs` lists a repository's deploys and CI
 * runs with their jobs, granted by its own name.
 *
 * Its write is an action, not a tool: `github.rerun_failed_jobs` through
 * `propose_action`, so the trust ladder, the ledger and Undo apply.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const READ_CHECK_LOGS_TOOL = 'github_read_check_logs';
export const READ_WORKFLOW_RUNS_TOOL = 'github_read_workflow_runs';

export function githubCheckLogsTools(ctx: RuntimeContext): StructuredToolInterface[] {
  const granted = new Set(ctx.harnessConfig.grantTools ?? []);
  return [...(granted.has(READ_CHECK_LOGS_TOOL) ? checkLogsTool(ctx) : []), ...(granted.has(READ_WORKFLOW_RUNS_TOOL) ? workflowRunsTool(ctx) : [])];
}

/**
 * github_read_workflow_runs — a repository's deploys and CI runs, newest
 * first, each with its jobs and the step that failed (backlog 049): did the
 * deploy run, on which commit, and where did it stop.
 * @param ctx - The turn.
 */
function workflowRunsTool(ctx: RuntimeContext): StructuredToolInterface[] {
  return [tool(
    async (args) => {
      try {
        const gh = await import('@/services/factory/githubChecks');
        const runs = await gh.listWorkflowRuns(ctx.orgId, args.repo, { workflow: args.workflow ?? null, branch: args.branch ?? null, limit: args.limit ?? 5 });
        // Jobs for the newest few, so a failed deploy names its step without a second read.
        const withJobs = await Promise.all(runs.map(async (r, i) => (i < 3 ? { ...r, jobs: (await gh.runJobs(ctx.orgId, args.repo, r.id).catch(() => [])).map(j => ({ name: j.name, conclusion: j.conclusion, failedStep: j.failedStep, ran: j.steps.filter(st => st.conclusion === 'success').map(st => st.name) })) } : r)));
        return JSON.stringify({ ok: true, repo: args.repo, runs: withJobs, note: runs.length === 0 ? 'No run matched.' : 'Read a failed run\'s log with github_read_check_logs (its url); re-run it with propose_action github.rerun_failed_jobs (its url); start a workflow that should have run with propose_action github.dispatch_workflow.' });
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message });
      }
    },
    {
      name: READ_WORKFLOW_RUNS_TOOL,
      description: 'A connected GitHub repository\'s workflow runs — deploys and CI — newest first, read with this workspace\'s token: each run\'s commit, event, status and conclusion, and for the newest three their jobs with the steps that ran and the one that failed. Use it to say whether a deploy ran, on which commit, and where it stopped.',
      schema: z.object({
        repo: z.string().describe('The repository, owner/name.'),
        workflow: z.string().optional().describe('One workflow, by file (.github/workflows/deploy.yml) or name; every workflow when omitted.'),
        branch: z.string().optional().describe('Only runs on this branch.'),
        limit: z.number().int().min(1).max(20).optional().describe('How many runs (default 5).'),
      }),
    },
  )];
}

function checkLogsTool(ctx: RuntimeContext): StructuredToolInterface[] {
  return [tool(
    async (args) => {
      try {
        const { readCheckLogs } = await import('@/services/factory/githubChecks');
        const logs = await readCheckLogs(ctx.orgId, args.url, { headSha: args.head_sha ?? null, maxChecks: 4 });
        const base = logs.baseBranch && logs.number !== null
          ? await (await import('@/services/factory/githubChecks')).branchChecks(ctx.orgId, logs.repo, logs.baseBranch).catch(() => null)
          : null;
        return JSON.stringify({
          ok: true,
          ...logs,
          base: base ? { branch: logs.baseBranch, sha: base.sha, failing: base.failing, complete: base.complete } : null,
          note: logs.failing.length === 0 ? 'No check on this head has failed.' : 'To re-run the failed jobs once, propose_action github.rerun_failed_jobs with this url.',
        });
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message });
      }
    },
    {
      name: READ_CHECK_LOGS_TOOL,
      description: 'What CI said on a GitHub pull request or one GitHub Actions run, read with this workspace\'s token: each failing check with its conclusion, annotations, the failing step and the last lines of its log; the files the pull request changes; and whether the same checks are red on the branch it targets. Use it before saying why a CI or a deploy is red.',
      schema: z.object({
        url: z.string().describe('A github.com pull request URL, or an Actions run URL (…/actions/runs/<id>).'),
        head_sha: z.string().optional().describe('The commit to read; the pull request\'s head when omitted.'),
      }),
    },
  )];
}
