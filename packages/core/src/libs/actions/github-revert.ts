/**
 * `github.revert_pull` — A RELEASE THAT TOOK AN ENVIRONMENT DOWN, TAKEN BACK
 * OUT (backlog 049; Chris, 2026-09-30: "An unhealthy one raises one
 * needs-person notification only after the Release engineer's own recovery
 * (re-run, redeploy, revert of the last release) has been tried and failed").
 * The environment was healthy on the commit before its last deploy and is not
 * on this one, and a re-run and a redeploy did not bring it back: GitHub's own
 * revert of the merged pull request is opened, and it merges itself on green
 * under `git.merge.rollback` (`pipelineChange.reconcileChanges`), deploying what
 * was live before the way every merge deploys.
 *
 * Undo closes the revert while it is open, or reverts the revert once merged:
 * the release goes back in. Only a person, or a seat whose harness grants it,
 * may open one (`github-pull.mayActOnPipeline`).
 */

import type { Action } from './types';
import { z } from 'zod';
import { mayActOnPipeline } from './github-pull';

export const REVERT_PULL_ACTION_ID = 'github.revert_pull';

const revertInput = z.object({
  url: z.string().url().describe('The merged pull request whose change to take back out.'),
  recordId: z.coerce.number().int().positive().optional().describe('The environment (or request) the revert answers, so its page shows it and its merge.'),
  reason: z.string().min(8).max(600).describe('Why: what went down on this release, and what was tried first.'),
});

type RevertInput = z.infer<typeof revertInput>;

export const githubRevertPullAction: Action<typeof revertInput> = {
  id: REVERT_PULL_ACTION_ID,
  name: 'Roll a release back',
  description: 'Open GitHub\'s revert of a merged pull request, with the workspace\'s GitHub token, for a release that took an environment down; it merges itself when its checks are green (git.merge.rollback) and deploys what was live before. Undo closes the revert, or reverts it once merged.',
  inputSchema: revertInput,
  grant: 'factory_write',
  external: true,
  // One revert per pull request.
  dedupKeyFor: input => `${REVERT_PULL_ACTION_ID}:${input.url}`,
  ownsDedupKey: true,
  async precheck(ctx) {
    const may = await mayActOnPipeline(ctx.orgId, ctx.invokedBy, REVERT_PULL_ACTION_ID);
    return may.ok ? undefined : may.why;
  },
  async reviewCard(_ctx, raw) {
    const input = raw as RevertInput;
    return {
      title: `Roll back ${input.url.replace(/^https:\/\/github\.com\//, '')}`,
      system: 'GitHub',
      headline: 'Open the revert; it merges itself on green and deploys what was live before.',
      badges: [{ label: 'GitHub' }, { label: 'Undo puts the release back' }],
      fields: [
        { label: 'Pull request', value: input.url, href: input.url },
        { label: 'Why', value: input.reason },
      ],
      nextAction: 'Approving opens the revert now.',
      verbs: { approve: 'Roll back', reject: 'Leave it' },
    };
  },
  async execute(ctx, input) {
    const { revertPull } = await import('@/services/factory/githubMerge');
    const { revertUrl } = await revertPull(ctx.orgId, input.url);
    const at = new Date().toISOString();
    const line = `Opened the rollback ${revertUrl.replace('https://github.com/', '')} of ${input.url.replace('https://github.com/', '')}: ${input.reason} It merges itself when its checks are green.`.slice(0, 600);
    if (input.recordId) {
      const { readRecord, writeMeta } = await import('./factory-dispatch');
      const record = await readRecord(ctx.orgId, input.recordId);
      if (record) {
        // Tracked like a pipeline change, so the reconciler merges it on green;
        // a red one is written down, and the record's own recovery takes the next step.
        await writeMeta(ctx.orgId, input.recordId, { pipelineChange: { url: revertUrl, reverts: input.url, title: `Roll back ${input.url.replace('https://github.com/', '')}`, riskClass: 'rollback', state: 'open', openedAt: at, pushedAt: at, by: ctx.invokedBy ?? null, actionRunId: ctx.runId ?? null, noRework: true } });
        const { noteOnRecord } = await import('@/services/factory/environments');
        await noteOnRecord(ctx.orgId, input.recordId, line, { runId: ctx.runId ?? null, url: revertUrl });
      }
    }
    return { reverted: false, revertPullRequest: revertUrl, url: revertUrl, reverts: input.url, ...(input.recordId ? { objectId: input.recordId } : {}), line };
  },
  async undo(ctx, input, result) {
    const url = typeof result?.url === 'string' ? result.url : null;
    if (!url) {
      return { note: 'This rollback named no pull request, so there was nothing to take back.' };
    }
    const { closePull, revertPull } = await import('@/services/factory/githubMerge');
    const closed = await closePull(ctx.orgId, url, 'Undone from Vocion: the rollback is withdrawn.');
    if (closed.state === 'merged') {
      const { revertUrl } = await revertPull(ctx.orgId, url);
      return { reopened: revertUrl, note: `The rollback had merged; putting the release back is open at ${revertUrl}.` };
    }
    if (input.recordId) {
      const { writeMeta } = await import('./factory-dispatch');
      await writeMeta(ctx.orgId, input.recordId, { pipelineChange: { url, state: 'withdrawn', undoneAt: new Date().toISOString() } });
    }
    return { closed: closed.closed, note: 'The rollback is closed; nothing was reverted.' };
  },
};
