/**
 * `github.rerun_failed_jobs` — RE-RUN WHAT FAILED, ONCE (backlog 049). A red
 * CI the diagnosis reads as flaky is re-run instead of sent back to the
 * engineer: a flaky test costs a re-run, not an attempt. Reversible by
 * nature — a re-run changes no code, and Undo cancels it while it is still
 * running — so the plugin's trust ladder runs it done for you.
 *
 * Proposed by core's own `ciFailed` routing and by the Release engineer seat
 * (`propose_action`). The workspace's own GitHub token does the work
 * (`services/factory/githubChecks.ts`); a token without Actions: write fails
 * the run with that reason, and `ciFailed` falls back to the engineer.
 */

import type { Action } from './types';
import { z } from 'zod';

const rerunInput = z.object({
  url: z.string().url().describe('The pull request whose failed checks to re-run, or one GitHub Actions run URL.'),
  headSha: z.string().min(7).optional().describe('The commit whose runs to re-run; the pull request\'s head when omitted.'),
  taskId: z.coerce.number().int().positive().optional().describe('The engineering task the pull request belongs to, when there is one.'),
  reason: z.string().max(500).optional().describe('Why a re-run and not a fix: what made the failure look flaky or infrastructural.'),
  recordId: z.coerce.number().int().positive().optional().describe('The record this re-run answers (an environment whose deploy failed), so its page shows it.'),
});

export const githubRerunFailedJobsAction: Action<typeof rerunInput> = {
  id: 'github.rerun_failed_jobs',
  name: 'Re-run failed CI jobs',
  description: 'Re-run the failed GitHub Actions jobs on a pull request\'s head (or one Actions run), with the workspace\'s GitHub token. For a check that failed for a reason unrelated to the change — a flaky test, a runner that went away. Changes no code; Undo cancels the re-run while it is still running.',
  inputSchema: rerunInput,
  grant: 'factory_write',
  external: true,
  // One re-run per head: a second proposal for the same commit is the same run.
  dedupKeyFor: input => `github.rerun_failed_jobs:${input.url}${input.headSha ? `@${input.headSha.slice(0, 12)}` : ''}`,
  ownsDedupKey: true,
  async reviewCard(_ctx, raw) {
    const input = raw as z.infer<typeof rerunInput>;
    return {
      title: `Re-run the failed CI jobs on ${input.url.replace(/^https:\/\/github\.com\//, '')}`,
      system: 'GitHub',
      headline: 'Re-run the failed jobs once; no code changes.',
      badges: [{ label: 'GitHub Actions' }, { label: 'Undo cancels the re-run' }],
      fields: [
        { label: 'Pull request or run', value: input.url, href: input.url },
        ...(input.headSha ? [{ label: 'Commit', value: input.headSha.slice(0, 12) }] : []),
        ...(input.reason ? [{ label: 'Why a re-run', value: input.reason }] : []),
      ],
      nextAction: 'Approving re-runs the failed jobs now; the checks report back on the pull request.',
      verbs: { approve: 'Re-run', reject: 'Leave it' },
    };
  },
  async execute(ctx, input) {
    const { rerunFailedJobs } = await import('@/services/factory/githubChecks');
    const res = await rerunFailedJobs(ctx.orgId, input.url, input.headSha ?? null);
    const line = `Re-ran the failed jobs of ${input.url.replace('https://github.com/', '')}${input.reason ? `: ${input.reason}` : ''}`.slice(0, 400);
    if (input.recordId) {
      const { noteOnRecord } = await import('@/services/factory/environments');
      await noteOnRecord(ctx.orgId, input.recordId, line, { runId: ctx.runId ?? null, url: input.url }).catch(() => undefined);
    }
    return { rerun: true, repo: res.repo, headSha: res.headSha, runIds: res.runIds, url: input.url, ...(input.recordId ? { objectId: input.recordId, line } : {}) };
  },
  async undo(ctx, _input, result) {
    const repo = typeof result?.repo === 'string' ? result.repo : null;
    const runIds = Array.isArray(result?.runIds) ? (result.runIds as unknown[]).map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
    if (!repo || runIds.length === 0) {
      return { cancelled: [], note: 'This re-run named no workflow run, so there was nothing to cancel.' };
    }
    const { cancelWorkflowRuns } = await import('@/services/factory/githubChecks');
    const out = await cancelWorkflowRuns(ctx.orgId, repo, runIds);
    return { ...out, note: out.finished.length > 0 ? 'A re-run that had already finished stays as it ended.' : 'The re-run was cancelled.' };
  },
};
