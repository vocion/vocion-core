/**
 * `repo.cancel_pipeline_run` — A RUN THAT SHOULD NOT BE RUNNING, STOPPED.
 *
 * A duplicate deploy started twice on one commit, a run on a branch that was
 * force-pushed over, a pipeline looping on itself: the Release engineer
 * stops it rather than waiting for it to fail or to deploy over a newer run.
 * Reversible by nature — Undo starts the run again, whole — so the plugin's
 * trust ladder runs it done for you. Cancelling changes no code and deploys
 * nothing; the run's own record says it was cancelled and by whom.
 *
 * The provider is chosen from the run URL or the repository
 * (`services/repo/provider.ts`).
 */

import type { Action } from './types';
import { z } from 'zod';

export const CANCEL_PIPELINE_RUN_ACTION_ID = 'repo.cancel_pipeline_run';

const cancelInput = z.object({
  url: z.string().url().optional().describe('The pipeline run\'s URL (…/actions/runs/<id>).'),
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'the repository as owner/name').optional().describe('The repository, owner/name, with runId.'),
  runId: z.coerce.number().int().positive().optional().describe('The run\'s id, with repo.'),
  reason: z.string().min(8).max(500).describe('Why it stops now: the duplicate it is, the newer run that supersedes it, the loop it is in.'),
  recordId: z.coerce.number().int().positive().optional().describe('The environment (or request) this run belongs to, so its page shows the stop.'),
});

type Input = z.infer<typeof cancelInput>;

/**
 * The run an input names, by URL or by repository and id.
 * @param orgId - The workspace.
 * @param input - The action's input.
 */
async function runRefOf(orgId: string, input: Pick<Input, 'url' | 'repo' | 'runId'>) {
  const { repoProviderFor } = await import('@/services/repo/provider');
  if (input.url) {
    const provider = await repoProviderFor(orgId, input.url);
    const ref = provider.parseRunRef(input.url);
    if (!ref) {
      throw new Error(`${input.url} is not a pipeline run URL on ${provider.label}.`);
    }
    return { provider, ref };
  }
  if (input.repo && input.runId) {
    const provider = await repoProviderFor(orgId, input.repo);
    return { provider, ref: { repo: input.repo, runId: input.runId, url: `https://github.com/${input.repo}/actions/runs/${input.runId}` } };
  }
  throw new Error('Name the run: its url, or repo and runId.');
}

export const repoCancelPipelineRunAction: Action<typeof cancelInput> = {
  id: CANCEL_PIPELINE_RUN_ACTION_ID,
  name: 'Stop a pipeline run',
  description: 'Cancel a pipeline run that is still running on a connected code host — a duplicate deploy, a run a newer one supersedes, a loop — with the workspace\'s credential. Changes no code. Undo starts the run again.',
  inputSchema: cancelInput,
  grant: 'factory_write',
  external: true,
  // One stop per run.
  dedupKeyFor: input => `${CANCEL_PIPELINE_RUN_ACTION_ID}:${input.url ?? `${input.repo}#${input.runId}`}`,
  ownsDedupKey: true,
  async precheck(ctx, input) {
    try {
      await runRefOf(ctx.orgId, input);
      return undefined;
    } catch (err) {
      return (err as Error).message;
    }
  },
  async reviewCard(ctx, raw) {
    const input = raw as Input;
    const named = await runRefOf(ctx.orgId, input).catch(() => null);
    const host = named?.provider.label ?? 'the code host';
    const url = named?.ref.url ?? input.url ?? null;
    return {
      title: `Stop pipeline run ${named ? `${named.ref.repo} #${named.ref.runId}` : input.url ?? `${input.repo} #${input.runId}`}`,
      system: host,
      headline: 'Cancel the run now; no code changes. Undo starts it again.',
      badges: [{ label: host }, { label: 'Undo starts it again' }],
      fields: [
        ...(url ? [{ label: 'Run', value: url, href: url }] : []),
        { label: 'Why now', value: input.reason },
      ],
      nextAction: 'Approving cancels the run now.',
      verbs: { approve: 'Stop it', reject: 'Leave it' },
    };
  },
  async execute(ctx, input) {
    const { provider, ref } = await runRefOf(ctx.orgId, input);
    const out = await provider.cancelPipelineRun(ctx.orgId, ref);
    const line = out.cancelled ? `Stopped pipeline run #${ref.runId} on ${ref.repo}: ${input.reason}` : `Pipeline run #${ref.runId} on ${ref.repo} had already finished; nothing to stop.`;
    if (input.recordId) {
      const { noteOnRecord } = await import('@/services/factory/environments');
      await noteOnRecord(ctx.orgId, input.recordId, line, { runId: ctx.runId ?? null, url: ref.url }).catch(() => undefined);
    }
    return { cancelled: out.cancelled, repo: ref.repo, runId: ref.runId, url: ref.url, ...(input.recordId ? { objectId: input.recordId } : {}), line };
  },
  async undo(ctx, input, result) {
    if (result?.cancelled !== true) {
      return { restarted: false, note: 'The run had already finished when this ran, so there is nothing to start again.' };
    }
    const { provider, ref } = await runRefOf(ctx.orgId, input);
    await provider.rerunPipelineRun(ctx.orgId, ref);
    return { restarted: true, runId: ref.runId, note: `Pipeline run #${ref.runId} on ${ref.repo} was started again.` };
  },
};
