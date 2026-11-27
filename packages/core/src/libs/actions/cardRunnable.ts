import type { Action, ActionCaller } from './types';
import { z } from 'zod';

/**
 * CARDS AN END USER TAPS — the pure half (`services/chat/workspaceCards.ts`
 * is the half that reads and writes rows).
 *
 * The decisions, in one place, because three callers (the turn that puts a card
 * up, the read that lists it, the call that runs it) must agree on them:
 *
 * 1. ONE CARD SHAPE. A card an end user taps is the dashboard chat's card
 *    (`label`, `actionId`, `input`, `draft`), persisted on the assistant
 *    message's `runs` like every other card. There is no second card system.
 * 2. THE ACTION OPTS IN with `Action.cardRunnable`, on the existing registry
 *    entry. Only those cards are handed to a calling app, because only those
 *    can be run by it.
 * 3. THE CALLER IS NOT INPUT. Who tapped is supplied by the calling app on
 *    `run_workspace_card` (or `talk_to_a_person`, the tap with no card) and
 *    reaches the action as `ctx.caller`. A card's
 *    stored input is the model's words, so a `caller` key in it is refused
 *    ({@link CARD_CALLER_KEY}): the card is not shown and a tap does not run.
 *    Refused, not stripped, so a model that tries it is visible in the logs
 *    and a card never quietly runs as something other than what it says.
 */

/** The key no card's input may carry: the one place a caller's identity is written is the call's own channel. */
export const CARD_CALLER_KEY = 'caller';

/**
 * The identity the calling app supplies, checked at the MCP boundary and again
 * by the action's own `callerSchema`. Strict: an app that adds a field (a role,
 * a phone) finds out now rather than having it silently dropped.
 */
export const CardCallerSchema: z.ZodType<ActionCaller> = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().max(320).pipe(z.email()),
}).strict();

/**
 * The action's card settings when an end user may run its cards, else undefined.
 *
 * WHY the `ownsDedupKey` refusal. An action that owns its dedup key keys its
 * runs on its own record, which wins over the per-card key `run_workspace_card`
 * (and `talk_to_a_person`) proposes under, and the action service's refresh path can execute on a
 * refresh (`outcome: 'refreshed'`). That would break "one card, one run", so
 * such an action is not card-runnable even when it declares `cardRunnable`.
 * (A card action's refresh executes only for Try again: the SAME run, after a
 * failure the action itself says is safe to repeat, `retryableFailure`.)
 * The registry has no validation step for action definitions, so the check
 * sits where every caller decides whether a card is runnable.
 * @param action - A registered action, or undefined for an id that is not registered.
 */
export function cardRunnableOf(action: Pick<Action, 'cardRunnable' | 'ownsDedupKey'> | undefined): Action['cardRunnable'] {
  return action?.ownsDedupKey ? undefined : action?.cardRunnable;
}

/** What a card's input came to against its action. */
export type CardInputCheck
  = | { ok: true; input: Record<string, unknown> }
    | { ok: false; reason: 'reserved-field' | 'invalid'; problem: string };

/**
 * Does this card's stored input hold up as the action's own input?
 * @param action - The card's registered action.
 * @param input - The input the card stored, as the model wrote it.
 */
export function checkCardInput(action: Pick<Action, 'inputSchema'>, input: Record<string, unknown>): CardInputCheck {
  if (Object.hasOwn(input, CARD_CALLER_KEY)) {
    return { ok: false, reason: 'reserved-field', problem: `the input carries "${CARD_CALLER_KEY}", which only the calling app may supply` };
  }
  const parsed = action.inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid', problem: parsed.error.issues.map(issue => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ') };
  }
  return { ok: true, input };
}
