/**
 * factory.check_live_again — A PERSON ASKS FOR THE LIVE CHECK AGAIN.
 *
 * A release's live check had two attempts and then nothing checked it again
 * by itself (`liveNext`: "Check it by hand on the live product, or fix what
 * stopped QA"). When what stopped QA is fixed — the product, its environment's
 * liveSetup, or the check itself (2026-10-02, FE-314 / REL-347) — the person
 * who owns the feature presses one button and QA checks the release again, a
 * fresh round of attempts, through the same event the retry raises
 * (`release.live_check.requested`). The person's word runs: no card.
 *
 * Undo puts the release's attempt count back; what QA saw on the round it
 * started is evidence and stays.
 */

import type { Action } from './types';
import { z } from 'zod';
import { factoryTypes } from '@/libs/factory/types';
import { readRecord, writeMeta } from './factory-dispatch';

export const CHECK_LIVE_AGAIN_ACTION_ID = 'factory.check_live_again';

const checkLiveAgainInput = z.object({
  /** The release to check on the live product again. */
  releaseId: z.coerce.number().int().positive(),
  /** Why now, in a sentence: what changed since the last check. */
  reason: z.string().min(1).max(500).optional().default('A person asked for the live check again.'),
});

const ids = (v: unknown): number[] => (Array.isArray(v) ? v : []).map(Number).filter(n => Number.isSafeInteger(n) && n > 0);

export const factoryCheckLiveAgainAction: Action<typeof checkLiveAgainInput> = {
  id: CHECK_LIVE_AGAIN_ACTION_ID,
  name: 'Check live again',
  description: 'Ask QA to check a shipped release on the live product again, a fresh round of attempts, after what stopped the last check is fixed. QA writes new flows from each feature\'s acceptance lines and records what it saw on the release and the features. Undo restores the release\'s attempt count; what the new check saw stays.',
  inputSchema: checkLiveAgainInput,
  grant: 'factory_write',
  external: false,
  dedupKeyFor: input => `${CHECK_LIVE_AGAIN_ACTION_ID}:${input.releaseId}:${Date.now()}`,
  ownsDedupKey: true,
  async reviewCard(_ctx, raw) {
    const input = raw as z.infer<typeof checkLiveAgainInput>;
    return {
      title: `Check release #${input.releaseId} on the live product again`,
      system: 'Vocion',
      headline: 'QA checks the release on the live product again, as the QA account.',
      badges: [{ label: 'Live check' }],
      fields: [{ label: 'Why now', value: input.reason }],
      nextAction: 'QA writes new flows from the acceptance lines and records what it saw.',
      verbs: { approve: 'Check again', reject: 'Leave it' },
    };
  },
  async precheck(ctx) {
    // A fresh round is a person's call; the retry after a first miss is the system's own
    // (`liveCheckEnded`). An agent asking for round after round would never stop.
    if (String(ctx.invokedBy ?? '').startsWith('agent:')) {
      return 'Checking a release live again is a person\'s call: the one retry after a miss already runs on its own. Report what the check saw and stop.';
    }
    return undefined;
  },
  async execute(ctx, input) {
    const release = await readRecord(ctx.orgId, input.releaseId);
    if (!release || release.typeSlug !== (await factoryTypes(ctx.orgId)).release) {
      throw new Error(`No release #${input.releaseId}.`);
    }
    const product = typeof release.meta.product === 'string' && release.meta.product.trim() ? release.meta.product.trim() : null;
    if (!product) {
      throw new Error(`Release #${input.releaseId} names no product, so there is no live product to check.`);
    }
    const previous = { liveAttempts: Number.isInteger(release.meta.liveAttempts) ? Number(release.meta.liveAttempts) : null };
    // A fresh round: the first attempt again, and the one retry after it.
    await writeMeta(ctx.orgId, release.id, { liveAttempts: 0 });
    const last = typeof release.meta.liveSummary === 'string' ? release.meta.liveSummary : null;
    const by = ctx.reviewedBy ?? 'a person';
    const requestedAt = new Date().toISOString();
    const { emitEvent, RELEASE_LIVE_CHECK_REQUESTED } = await import('@/services/EventService');
    const payload: import('@/services/EventService').ReleaseLiveCheckRequestedPayload = {
      releaseId: release.id,
      product,
      userFacing: true,
      attempt: 1,
      lastFailure: `${by} asked for the live check again (${input.reason.replace(/[.\s]+$/, '')}).${last ? ` The last check said: ${last}` : ''}`.slice(0, 600),
      requestIds: ids(release.meta.requestIds),
      taskIds: ids(release.meta.taskIds),
    };
    await emitEvent({ orgId: ctx.orgId, type: RELEASE_LIVE_CHECK_REQUESTED, payload, dedupeKey: `${RELEASE_LIVE_CHECK_REQUESTED}:${release.id}:again:${requestedAt}`, invokedBy: ctx.reviewedBy ?? 'action:factory.check_live_again', dispatchMode: 'auto' });
    return { releaseId: release.id, objectId: release.id, requestedAt, previous, line: `Checking release #${release.id} on the live product again.` };
  },
  async undo(ctx, _input, result) {
    const p = (result.previous ?? {}) as { liveAttempts?: number | null };
    await writeMeta(ctx.orgId, Number(result.releaseId), { liveAttempts: p.liveAttempts ?? null });
    return { releaseId: result.releaseId, note: 'The attempt count is back; what the check saw stays on the release.' };
  },
};
