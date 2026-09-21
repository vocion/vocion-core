/**
 * Saying it where the work happened — the one place a self-update becomes a
 * chip in the transcript.
 *
 * An action executes in `ActionService`, which has no conversation and
 * therefore no emitter; a tool has `ctx.emit` but no business deciding what a
 * self-update reads as. So the tools that can propose one call this, it asks
 * the class whether the kind counts, and the wording comes from
 * `selfUpdateReceipt` — the same function the Activity row and the review
 * toast read. One sentence, three surfaces.
 *
 * A proposal that landed under the bar is emitted too, as `proposed`: the
 * turn still changed something about the system's future, and a transcript
 * that only mentions the ones that ran would let the queued ones disappear.
 */

import type { RuntimeContext } from './types';
import type { ProposeResult } from '@/services/ActionService';
import { isSelfUpdate, selfUpdateReceipt } from '@/libs/actions/selfUpdate';

/**
 * Emit the chip for a self-update that was just proposed or executed.
 * No-op for any action kind outside the class, and for a proposal that
 * changed nothing (an `already_decided` outcome writes no history).
 * @param ctx - The turn's runtime context, for its emitter.
 * @param opts - What was proposed.
 * @param opts.actionId - Registered action id.
 * @param opts.input - The action's input, as proposed.
 * @param opts.res - What `proposeAction` returned.
 */
export function emitSelfUpdate(
  ctx: Pick<RuntimeContext, 'emit'>,
  opts: { actionId: string; input: Record<string, unknown>; res: Pick<ProposeResult, 'runId' | 'status' | 'result' | 'outcome'> },
): void {
  if (!isSelfUpdate(opts.actionId) || opts.res.outcome === 'already_decided') {
    return;
  }
  const receipt = selfUpdateReceipt({
    actionId: opts.actionId,
    runId: opts.res.runId,
    status: opts.res.status === 'done' ? 'applied' : 'proposed',
    input: opts.input,
    result: opts.res.result ?? null,
  });
  if (!receipt) {
    return;
  }
  ctx.emit({ type: 'self_update', selfUpdate: receipt });
}
