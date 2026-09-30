/**
 * github_read_check_logs — what CI said on a pull request (or one Actions
 * run), read with the workspace's own GitHub token: each failing check, its
 * annotations, the failing step and the tail of that step's log, and the
 * files the pull request changes. For the seat that owns the pipeline
 * (backlog 049); granted-only (`harness.grantTools: [github_read_check_logs]`).
 *
 * Its write is an action, not a tool: `github.rerun_failed_jobs` through
 * `propose_action`, so the trust ladder, the ledger and Undo apply.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const READ_CHECK_LOGS_TOOL = 'github_read_check_logs';

export function githubCheckLogsTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!(ctx.harnessConfig.grantTools ?? []).includes(READ_CHECK_LOGS_TOOL)) {
    return [];
  }
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
