/**
 * THE REPO FAMILY'S READS — what an agent reads on the connected code host,
 * named for the construct and never for the vendor (`services/repo/provider.ts`).
 *
 *   repo_read_pull           one pull request, live: title, description, author,
 *                            branches, files changed, reviews, check conclusions
 *   repo_read_diff           the unified diff of a pull request or of two refs,
 *                            and which files fall outside a task's allowed paths
 *   repo_read_file           a file at a ref, through the host credential
 *   repo_read_check_logs     what the checks said: each failing check, its
 *                            annotations, the failing step's log tail (granted)
 *   repo_read_pipeline_runs  a repository's pipeline runs, newest first, with
 *                            each run's jobs and the step that failed (granted)
 *
 * WHY. The knowledge index holds one document per pull request — no diff, no
 * comments, no files — and `fetch_url` reads the public web, so a private
 * repository answered 404 and the reviewer judged a description (red team,
 * 2026-09-26). The first three are present for any agent with a code-host
 * source in scope. The last two stay granted-only, each by its own name
 * (`harness.grantTools`, backlog 049), because they belong to the seat that
 * owns the pipeline; their former names (`github_read_check_logs`,
 * `github_read_workflow_runs`) still grant them.
 *
 * Their writes are actions, not tools: `repo.comment_pull`,
 * `repo.submit_review`, `repo.rerun_failed_checks`, `repo.dispatch_pipeline`,
 * `repo.cancel_pipeline_run` through `propose_action`, so the trust ladder,
 * the ledger and Undo apply.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { familyInScope, granted } from '@/libs/connectors/families';

export const READ_PULL_TOOL = 'repo_read_pull';
export const READ_DIFF_TOOL = 'repo_read_diff';
export const READ_FILE_TOOL = 'repo_read_file';
export const READ_CHECK_LOGS_TOOL = 'repo_read_check_logs';
export const READ_PIPELINE_RUNS_TOOL = 'repo_read_pipeline_runs';
/** The names these two granted reads had before the family rename; a grant that names one still grants it. */
export const FORMER_CHECK_LOGS_TOOL = 'github_read_check_logs';
export const FORMER_PIPELINE_RUNS_TOOL = 'github_read_workflow_runs';

const REPO = z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'the repository as owner/name').describe('The repository, owner/name.');

/**
 * The repo family's tools for one turn: the three reads when a code-host
 * source is in scope, the two pipeline reads when granted by either name.
 * @param ctx - The turn.
 */
export function repoTools(ctx: RuntimeContext): StructuredToolInterface[] {
  const inScope = familyInScope(ctx, 'repo');
  return [
    ...(inScope ? [readPullTool(ctx), readDiffTool(ctx), readFileTool(ctx)] : []),
    ...(granted(ctx, READ_CHECK_LOGS_TOOL, FORMER_CHECK_LOGS_TOOL) ? [checkLogsTool(ctx)] : []),
    ...(granted(ctx, READ_PIPELINE_RUNS_TOOL, FORMER_PIPELINE_RUNS_TOOL) ? [pipelineRunsTool(ctx)] : []),
  ];
}

/**
 * The pull request a call names: by URL, or by repository and number.
 * @param orgId - The workspace.
 * @param args - `url`, or `repo` + `number`.
 * @param args.url - The pull request's URL.
 * @param args.repo - The repository as `owner/name`.
 * @param args.number - The pull request number.
 */
async function pullRefFrom(orgId: string, args: { url?: string; repo?: string; number?: number }) {
  const { repoProviderFor } = await import('@/services/repo/provider');
  if (args.url) {
    const provider = await repoProviderFor(orgId, args.url);
    const ref = provider.parsePullRef(args.url);
    if (!ref) {
      throw new Error(`${args.url} is not a pull request URL on ${provider.label}.`);
    }
    return { provider, ref };
  }
  if (args.repo && args.number) {
    const provider = await repoProviderFor(orgId, args.repo);
    return { provider, ref: { repo: args.repo, number: args.number, url: provider.pullUrl(args.repo, args.number) } };
  }
  throw new Error('Name the pull request: its url, or repo and number.');
}

function readPullTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const { provider, ref } = await pullRefFrom(ctx.orgId, args);
        const pull = await provider.readPull(ctx.orgId, ref);
        return JSON.stringify({ ok: true, host: provider.label, pull, note: `Read its diff with ${READ_DIFF_TOOL} (the url); the checks' logs with ${READ_CHECK_LOGS_TOOL} when granted.` });
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message });
      }
    },
    {
      name: READ_PULL_TOOL,
      description: 'One pull request on a connected code host, read live with the workspace\'s own credential: title, description (the engineer\'s report), author, state, draft, merged, head and base branch, head commit, the files it changes with their line counts, the reviews submitted, the conclusions of its checks and its labels. No diff: read that with repo_read_diff. Use it before judging, commenting on or merging a pull request; the index holds only a summary.',
      schema: z.object({
        url: z.string().optional().describe('The pull request\'s URL.'),
        repo: REPO.optional(),
        number: z.number().int().positive().optional().describe('The pull request number, with repo.'),
      }),
    },
  );
}

function readDiffTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const { repoProviderFor, pathsInDiff, pathsOutsideAllowed } = await import('@/services/repo/provider');
        let diff: string;
        let about: string;
        if (args.url) {
          const { provider, ref } = await pullRefFrom(ctx.orgId, { url: args.url });
          diff = await provider.readPullDiff(ctx.orgId, ref);
          about = ref.url;
        } else if (args.repo && args.base && args.head) {
          const provider = await repoProviderFor(ctx.orgId, args.repo);
          diff = await provider.readCompareDiff(ctx.orgId, args.repo, args.base, args.head);
          about = `${args.repo} ${args.base}...${args.head}`;
        } else {
          return JSON.stringify({ ok: false, error: 'Name a pull request (url) or a comparison (repo, base, head).' });
        }
        const files = pathsInDiff(diff);
        let allowedPaths: string[] | null = null;
        let outsideAllowedPaths: string[] | null = null;
        if (args.task_id) {
          const { readRecord } = await import('@/libs/actions/factory-dispatch');
          const task = await readRecord(ctx.orgId, args.task_id);
          if (!task) {
            return JSON.stringify({ ok: false, error: `No record #${args.task_id} in this workspace.` });
          }
          allowedPaths = Array.isArray(task.meta.allowedPaths) ? (task.meta.allowedPaths as unknown[]).map(String) : [];
          outsideAllowedPaths = pathsOutsideAllowed(files, allowedPaths);
        }
        return JSON.stringify({
          ok: true,
          about,
          files,
          ...(allowedPaths !== null ? { allowedPaths, outsideAllowedPaths } : {}),
          diff,
          note: outsideAllowedPaths && outsideAllowedPaths.length > 0
            ? `${outsideAllowedPaths.length} file(s) fall outside task #${args.task_id}'s allowed paths: a finding against the contract's path rule, unless the task names them as an assumption.`
            : allowedPaths && allowedPaths.length === 0 ? `Task #${args.task_id} names no allowed paths, so nothing bounded this change.` : undefined,
        });
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message });
      }
    },
    {
      name: READ_DIFF_TOOL,
      description: 'The unified diff of a pull request (url) or between two refs (repo, base, head) on a connected code host, read with the workspace\'s credential and cut to what one read can hold, with the list of files it touches. With task_id, also which of those files no allowed path of that engineering task covers (outsideAllowedPaths). Use it to judge a change against its contract, or to see what a branch adds over its base.',
      schema: z.object({
        url: z.string().optional().describe('The pull request\'s URL.'),
        repo: REPO.optional(),
        base: z.string().optional().describe('The base ref of a comparison (a branch, tag or commit), with repo and head.'),
        head: z.string().optional().describe('The head ref of a comparison, with repo and base.'),
        task_id: z.number().int().positive().optional().describe('The engineering task whose allowedPaths the files are checked against.'),
      }),
    },
  );
}

function readFileTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const { repoProviderFor } = await import('@/services/repo/provider');
        const provider = await repoProviderFor(ctx.orgId, args.repo);
        const file = await provider.readFile(ctx.orgId, args.repo, args.path, args.ref ?? null);
        return JSON.stringify({ ok: true, host: provider.label, ...file, ...(file.truncated ? { note: `Cut at ${file.text.length} of ${file.size} characters.` } : {}) });
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message });
      }
    },
    {
      name: READ_FILE_TOOL,
      description: 'A file at a ref in a connected repository, read whole through the workspace\'s own credential — so a private repository answers, which fetch_url on the web cannot. Give the repository as owner/name, the path from its root and, when not the default branch, the ref (a branch, tag or commit). Read a file whole before proposing to change it.',
      schema: z.object({
        repo: REPO,
        path: z.string().min(1).max(400).describe('The file, from the repository root, e.g. .github/workflows/ci.yml.'),
        ref: z.string().max(200).optional().describe('A branch, tag or commit; the default branch when omitted.'),
      }),
    },
  );
}

/**
 * repo_read_pipeline_runs — a repository's deploys and CI runs, newest first,
 * each with its jobs and the step that failed (backlog 049): did the deploy
 * run, on which commit, and where did it stop.
 * @param ctx - The turn.
 */
function pipelineRunsTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const gh = await import('@/services/factory/githubChecks');
        const runs = await gh.listWorkflowRuns(ctx.orgId, args.repo, { workflow: args.workflow ?? null, branch: args.branch ?? null, limit: args.limit ?? 5 });
        // Jobs for the newest few, so a failed deploy names its step without a second read.
        const withJobs = await Promise.all(runs.map(async (r, i) => (i < 3 ? { ...r, jobs: (await gh.runJobs(ctx.orgId, args.repo, r.id).catch(() => [])).map(j => ({ name: j.name, conclusion: j.conclusion, failedStep: j.failedStep, ran: j.steps.filter(st => st.conclusion === 'success').map(st => st.name) })) } : r)));
        return JSON.stringify({ ok: true, repo: args.repo, runs: withJobs, note: runs.length === 0 ? 'No run matched.' : `Read a failed run's log with ${READ_CHECK_LOGS_TOOL} (its url); re-run it with propose_action repo.rerun_failed_checks (its url); start a pipeline that should have run with propose_action repo.dispatch_pipeline; stop a run that should not be running with propose_action repo.cancel_pipeline_run.` });
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message });
      }
    },
    {
      name: READ_PIPELINE_RUNS_TOOL,
      description: 'A connected repository\'s pipeline runs — deploys and CI — newest first, read with this workspace\'s credential: each run\'s commit, event, status and conclusion, and for the newest three their jobs with the steps that ran and the one that failed. Use it to say whether a deploy ran, on which commit, and where it stopped.',
      schema: z.object({
        repo: REPO,
        workflow: z.string().optional().describe('One pipeline, by its definition file (.github/workflows/deploy.yml) or name; every pipeline when omitted.'),
        branch: z.string().optional().describe('Only runs on this branch.'),
        limit: z.number().int().min(1).max(20).optional().describe('How many runs (default 5).'),
      }),
    },
  );
}

function checkLogsTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const { readCheckLogs, branchChecks } = await import('@/services/factory/githubChecks');
        const logs = await readCheckLogs(ctx.orgId, args.url, { headSha: args.head_sha ?? null, maxChecks: 4 });
        const base = logs.baseBranch && logs.number !== null
          ? await branchChecks(ctx.orgId, logs.repo, logs.baseBranch).catch(() => null)
          : null;
        return JSON.stringify({
          ok: true,
          ...logs,
          base: base ? { branch: logs.baseBranch, sha: base.sha, failing: base.failing, complete: base.complete } : null,
          note: logs.failing.length === 0 ? 'No check on this head has failed.' : 'To re-run the failed checks once, propose_action repo.rerun_failed_checks with this url.',
        });
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message });
      }
    },
    {
      name: READ_CHECK_LOGS_TOOL,
      description: 'What the checks said on a pull request or one pipeline run on a connected code host, read with this workspace\'s credential: each failing check with its conclusion, annotations, the failing step and the last lines of its log; the files the pull request changes; and whether the same checks are red on the branch it targets. Use it before saying why a check or a deploy is red.',
      schema: z.object({
        url: z.string().describe('A pull request URL, or a pipeline run URL (…/actions/runs/<id>).'),
        head_sha: z.string().optional().describe('The commit to read; the pull request\'s head when omitted.'),
      }),
    },
  );
}
