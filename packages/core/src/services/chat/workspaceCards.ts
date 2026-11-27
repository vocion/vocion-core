/**
 * Cards over MCP: the cards `ask_workspace` hands back, and the call that runs
 * one when the end user taps it (`run_workspace_card`).
 *
 * THE FLOW. A caller app (a support chat in a mobile or web app) sends the
 * user's message through `ask_workspace`. The agent answers and may put up a
 * card with `recommend_action` ("Create a ticket"); the dashboard chat's own
 * path writes it onto the assistant message's `runs` (`RunCollector`), and this
 * file decides which of those cards the caller gets. When the user taps one,
 * the app calls `run_workspace_card` with the conversation id, the card id and
 * the user's identity; {@link runWorkspaceCard} runs the card's registered
 * action through `proposeAction`, so the grant check, the gates, the
 * `action_run` row, the audit trail and `execute` are the ones every other
 * action gets.
 *
 * A TAP IS NOT A WORKSPACE PERSON'S WORD. The card's input was written by an
 * agent that may have read untrusted text (a Help Center article, the end
 * user's own message), and the end user is not a member of the workspace. So
 * the tap is proposed as the card's AGENT proposing (`cardTapPrincipal`, with
 * the confidence the agent wrote, `origin.byPerson: false`), never as a
 * person's own proposal: the action's declared gates and holds apply, and the
 * autonomy ladder decides. At `execute-with-approval` the run waits in Review
 * for a workspace person and the tap returns `pending`; it runs at once only
 * where the ladder lets an agent's proposal run on its own.
 *
 * WHICH CARDS THE CALLER GETS (`judgeCard`). Only a card whose action is
 * registered AND declares `cardRunnable` AND is on for the workspace (not set
 * below `execute-with-approval` on its autonomy ladder) AND whose input passes
 * the action's own schema. A card for any other action is not returned: the
 * caller could not run it, and it keeps going to Review as before. A
 * `cardRunnable` card whose input is not whole is returned as the dashboard's
 * "Draft needed" card (its `draft.prompt` is what the app sends back through
 * `ask_workspace`), never as a button that can only fail.
 *
 * ONE CARD, ONE RUN. {@link runWorkspaceCard} proposes under a key built from
 * the conversation and the card id ({@link workspaceCardDedupKey}, on the
 * `card:` prefix `ActionService` treats as an idempotency key), so a second tap
 * gets the earlier run back instead of running the action again. A run that is
 * `done`, `rejected`, `undone`, `executing` or `awaiting_execution` is returned
 * as it is (`already_decided`, nothing ran); a run that is still `pending` or
 * has `failed` is refreshed in place and goes (back) to `pending` for a person,
 * on the same run id (`refreshed`). TRY AGAIN is the one exception: a run that
 * failed in a way its action says is safe to repeat (`retryableFailure`), with
 * attempts left (`MAX_AUTOMATIC_ATTEMPTS`), is judged by the ladder again on
 * the next tap, so it can run again at once, still on the same run id.
 * `ActionService` checks then writes without a lock, so two taps at the same
 * instant are serialised here by an advisory lock on the same key.
 *
 * ONE CARD, ONE END USER. The first tap binds the card to its `caller.id` (`tappedBy` on
 * the stored card); a tap by a different id is `CARD_NOT_AVAILABLE`, because a refresh
 * would otherwise swap the caller on a run still waiting in Review ({@link bindCardToCaller}).
 *
 * WHICH CARDS CAN RUN. Only a card minted for the end user on an `ask_workspace`
 * turn (`endUser` on the stored card), still waiting for a tap (`proposed`) or
 * already run by a tap (`decided`). A card filed to Review, deferred, expired or
 * never put up is `CARD_NOT_AVAILABLE`; a card the dashboard chat drew is
 * `CARD_NOT_FOUND`: this call must not become a door onto every card in the org.
 */

import type { ActionCaller } from '@/libs/actions/types';
import type { ProposeResult } from '@/services/ActionService';
import type { Principal } from '@/services/authz';
import type { ConversationRun } from '@/services/ConversationService';
import { cardRunnableOf, checkCardInput } from '@/libs/actions/cardRunnable';
import { policyKeyForRun } from '@/libs/actions/policyKey';
import { getAction } from '@/libs/actions/registry';
import { withAdvisoryLock } from '@/libs/advisoryLock';
import { ActionError, CARD_DEDUP_PREFIX, proposeAction } from '@/services/ActionService';
import { draftPrompt } from '@/services/agents/cardBackstop';
import { rungIndex } from '@/services/autonomy/rungs';
import { getConversation, markCardRun, readCardRun } from '@/services/ConversationService';

/** A refusal with a code the calling app can branch on; nothing ran. */
export class WorkspaceCardError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'WorkspaceCardError';
    this.code = code;
  }
}

/** One card as the calling app gets it: the dashboard card's shape, with the id it taps by. */
export type WorkspaceCard = {
  /** Stable id, scoped to the conversation: what `run_workspace_card` takes. */
  id: string;
  label: string;
  actionId: string;
  /** The words on the button, when they are not the label. */
  actionLabel?: string;
  /** What the action will run with. Shown to the user if the app wants; never carries the caller. */
  input: Record<string, unknown>;
  rationale?: string;
  /**
   * Present when the input is not whole: pressing the button means sending
   * `draft.prompt` back through `ask_workspace` so the agent drafts it. The
   * card cannot be run until then.
   */
  draft?: { prompt: string; missing: string };
};

/** What the turn decides about one card an agent put up. */
export type CardVerdict
  = | { kind: 'not-runnable' }
    | { kind: 'refused'; why: string }
    | { kind: 'card'; draft?: { prompt: string; missing: string } };

/**
 * Is this action on for the workspace's end users?
 *
 * The switch is the one a workspace already has for what an action may do: the
 * autonomy ladder (`trust.yaml`). Below `execute-with-approval` (`observe`,
 * `recommend`, `assist`) a kind is not to be run, so it is neither shown as a
 * card nor run by a tap. At or above it the card is shown, and what a tap does
 * is the ladder's call (see `proposeCardTap`): wait for a person at
 * `execute-with-approval`, run at once where an agent's proposal may.
 * @param orgId - The workspace.
 * @param actionId - The action's registered id.
 * @param input - The card's input, for an action whose ladder key depends on it.
 */
export async function cardActionEnabled(orgId: string, actionId: string, input: Record<string, unknown>): Promise<boolean> {
  const { effectivePolicy } = await import('@/services/autonomy/AutonomyService');
  const policy = await effectivePolicy(orgId, policyKeyForRun(actionId, input));
  return rungIndex(policy.rung) >= rungIndex('execute-with-approval');
}

/**
 * Decide what a card an agent put up becomes for the calling app.
 * @param orgId - The workspace.
 * @param card - The recommendation as the turn saw it.
 * @param card.actionId - The action it names.
 * @param card.label - Its label.
 * @param card.input - Its input, as the model wrote it.
 * @param card.draft - The card pass's own "Draft needed" marker, when it set one.
 * @param card.draft.prompt - What the app sends back through `ask_workspace` to get the missing input drafted.
 * @param card.draft.missing - What the card still lacks, in words for the end user.
 */
export async function judgeCard(orgId: string, card: { actionId: string; label: string; input: Record<string, unknown>; draft?: { prompt: string; missing: string } }): Promise<CardVerdict> {
  const action = card.actionId ? getAction(card.actionId) : undefined;
  if (!action || !cardRunnableOf(action)) {
    return { kind: 'not-runnable' };
  }
  if (!(await cardActionEnabled(orgId, action.id, card.input))) {
    return { kind: 'refused', why: `${action.id} is turned off for this workspace` };
  }
  if (card.draft) {
    return { kind: 'card', draft: card.draft };
  }
  const checked = checkCardInput(action, card.input);
  if (checked.ok) {
    return { kind: 'card' };
  }
  if (checked.reason === 'reserved-field') {
    return { kind: 'refused', why: checked.problem };
  }
  return { kind: 'card', draft: { prompt: draftPrompt(action.name, card.label, checked.problem), missing: checked.problem } };
}

/**
 * The cards of one turn the caller may tap, in the order they were put up.
 * @param runs - The turn's stored runs.
 * @param cardIds - The ids this turn minted for `cardRunnable` cards.
 */
export function workspaceCardsOf(runs: readonly ConversationRun[], cardIds: ReadonlySet<string>): WorkspaceCard[] {
  return runs.flatMap(run => cardsFromRun(run, cardIds));
}

/**
 * The card a stored run turns into for the caller: none for a run that is not a
 * card of this turn, or one the turn marked unfiled.
 * @param run - One stored run.
 * @param cardIds - The ids this turn minted for `cardRunnable` cards.
 */
function cardsFromRun(run: ConversationRun, cardIds: ReadonlySet<string>): WorkspaceCard[] {
  if (run.type !== 'card' || !run.id || !cardIds.has(run.id) || run.state === 'unfiled') {
    return [];
  }
  return [{
    id: run.id,
    label: run.label,
    actionId: run.actionId,
    ...(run.actionLabel ? { actionLabel: run.actionLabel } : {}),
    input: run.input ?? {},
    ...(run.rationale ? { rationale: run.rationale } : {}),
    ...(run.draft ? { draft: run.draft } : {}),
  }];
}

export type RunWorkspaceCardInput = {
  orgId: string;
  /** Who is calling, as the audit trail names them: `token:<id>` over HTTP, `mcp` on stdio. */
  actorId: string;
  /** The token's principal: its grants decide whether the action may run at all. */
  principal: Principal;
  conversationId: number;
  cardId: string;
  /** The end user, as the calling app knows them. */
  caller: unknown;
};

export type RunWorkspaceCardResult = {
  conversationId: number;
  cardId: string;
  actionId: string;
  /** The `action_run` this tap made or found; 0 when this tap ran nothing and no run was found (`already_underway`). */
  runId: number;
  /**
   * `pending` (waiting for a workspace person in Review: the action has NOT run; the normal
   * answer at `execute-with-approval`, or when a gate held it), `done` (it ran), `failed` (see
   * `error`), `awaiting_execution`, `rejected` or `undone`; `executing` too when an earlier
   * tap's run is still going (`already_decided`). Read it WITH `outcome`: `already_underway` +
   * `done` means this tap ran nothing.
   */
  status: string;
  /**
   * `created` (this tap made the run: it ran if `status` is `done` or `failed`, and is waiting
   * for a person if `pending`), `refreshed` (the card's earlier run was still `pending` or had
   * `failed`: it was updated in place and is `pending` for a person, nothing ran now; or, after
   * a failure the action says is safe to repeat, it ran again now if `status` is `done` or `failed`),
   * `already_decided` (an earlier tap's run in any other status is returned; nothing ran now) or `already_underway`
   * (the action says what was asked is already happening, or another tap on this card is
   * running it right now; nothing ran now).
   */
  outcome: string;
  /**
   * What the action returned when THIS tap ran it. Null otherwise: when the run waits for a person,
   * failed, or an earlier tap ran it (`already_decided` hands back the run's status, not its result).
   * Sent to the app as the action returned it, so a card-runnable action keeps it end-user safe.
   */
  result: Record<string, unknown> | null;
  /**
   * Fixed text, never the action's own error, when `status` is `failed`:
   * `CARD_RUN_RETRYABLE_MESSAGE` when `retryable`, else `CARD_RUN_FAILED_MESSAGE`.
   */
  error?: string;
  /**
   * Set (true) when `status` is `failed`, the action says this failure is safe to repeat, and
   * the run has attempts left (`ActionRunResult.canTryAgain`), so the app may offer Try again:
   * the next tap is judged again and can run at once, or wait in Review if the ladder says so.
   * Absent means do not offer Try again. Not `failureRecovery().retryable`, which is about a
   * person editing and approving a failed run.
   */
  retryable?: true;
  /**
   * The action's own line about what is already happening (`already_underway`). Its link is left
   * out: it points at the workspace's run, which the app's user cannot open.
   */
  underway?: { line: string };
};

/** Card states a tap may run: waiting for the tap, or already run by one (the dedup answers with that run). */
const RUNNABLE_CARD_STATES: ReadonlySet<string> = new Set(['proposed', 'decided']);

/** How long a tap waits for another tap on the same card to finish before it answers `already_underway`. */
const CARD_LOCK_WAIT_ATTEMPTS = 25;
const CARD_LOCK_WAIT_MS = 200;

/**
 * The idempotency key a card's tap proposes under: one card in one conversation
 * is one run. Built on the `card:` prefix `ActionService` treats as an
 * idempotency key, but NOT from `cardDedupKey()`, which hashes the action, label
 * and input: another end user's identical card (same label, same input) in
 * another conversation must still run.
 * @param actionId - The card's registered action.
 * @param conversationId - The conversation the card is in.
 * @param cardId - The card's id.
 */
export function workspaceCardDedupKey(actionId: string, conversationId: number, cardId: string): string {
  return `${CARD_DEDUP_PREFIX}${actionId}:c${conversationId}:${cardId}`;
}

/**
 * Why a stored card cannot be run, in words for the app; null when it can.
 * @param state - The card's stored state (`proposed` when it has none).
 * @param card - The card.
 * @param card.reason - Why the turn did not put it up, when it did not.
 */
function cardUnavailableReason(state: string, card: { reason?: string }): string | null {
  if (RUNNABLE_CARD_STATES.has(state)) {
    return null;
  }
  switch (state) {
    case 'filed':
      return 'it was filed to Review, where a person decides it';
    case 'deferred':
      return 'it was set aside for later';
    case 'expired':
      return 'it expired';
    case 'unfiled':
      return `it was never put up${card.reason ? ` (${card.reason})` : ''}`;
    default:
      return `it is in state "${state}"`;
  }
}

/**
 * Run `work` while holding this tap's lock (one card's, or one conversation's
 * Talk to a person taps), waiting a short while when another tap holds it.
 * Null when the lock stayed taken for the whole wait.
 * @param lockName - The lock name.
 * @param work - What one tap does.
 */
export async function withCardLock<T>(lockName: string, work: () => Promise<T>): Promise<{ value: T } | null> {
  for (let attempt = 0; attempt < CARD_LOCK_WAIT_ATTEMPTS; attempt++) {
    const locked = await withAdvisoryLock(lockName, work);
    if (locked.ran) {
      return { value: locked.value };
    }
    await new Promise(resolve => setTimeout(resolve, CARD_LOCK_WAIT_MS));
  }
  return null;
}

/**
 * What `run_workspace_card` tells the app when the action ran and failed. Fixed
 * text on purpose: the action's own error text can name internals (a vendor's
 * reply, a record id, a stack line), and no action marks a message as safe for
 * an end user, so none is passed through. The real text stays on the
 * `action_run` row and on the card for the workspace's people.
 */
export const CARD_RUN_FAILED_MESSAGE = 'the action did not complete. Tell your user it did not go through. Tapping the card again does not run it again: it puts the same request back in front of a workspace person in Review.';

/**
 * What `run_workspace_card` tells the app when the action failed in a way it
 * says is safe to repeat (`retryableFailure`). Fixed text for the same reason
 * as {@link CARD_RUN_FAILED_MESSAGE}.
 */
export const CARD_RUN_RETRYABLE_MESSAGE = 'the action could not finish because a service it needs was busy or could not be reached, so it may or may not have gone through. Tell your user that, and that tapping the card again tries again without doing it twice, or puts it in front of a workspace person if it cannot run on its own now.';

/**
 * What `run_workspace_card` tells the app when the workspace's own check sent
 * the request back before it ran. Fixed text on purpose: the check's message is
 * written to the agent that authored the card, with its findings.
 */
export const CARD_RETURNED_MESSAGE = 'the workspace\'s own check sent this request back before it ran, so nothing ran. Tell your user it could not be done as asked and was not carried out.';

/** Why a tap waits for a person when the card's agent gave no confidence in it (see `proposeCardTap`). */
const CARD_WITHOUT_CONFIDENCE_HOLD = 'the agent gave no confidence in this card, so a person decides';

/**
 * Everything one end user's tap hands to `proposeAction`, gathered so the
 * lock's work is a plain function. A card tap and a Talk to a person tap
 * (`talkToAPerson.ts`) both build one.
 */
export type EndUserProposal = {
  orgId: string;
  actionId: string;
  /** The conversation's agent: the tap is proposed as this agent's own proposal. */
  agentSlug: string;
  rationale?: string;
  /** How sure the proposal is, 0 to 1; absent when the agent gave none, and then a person decides. */
  confidence?: number;
  conversationId: number;
  dedupKey: string;
  /** The token that called, for the audit trail. */
  actorId: string;
  tokenPrincipal: Principal;
  /** The action's input, already checked against its schema. */
  input: Record<string, unknown>;
  caller: ActionCaller;
};

/** One tap on a card: the proposal plus the card it was made from. */
type CardTap = EndUserProposal & { cardId: string };

/**
 * The principal a tap is proposed as: the card's agent, holding exactly the
 * grants and scope of the token that called.
 *
 * WHY AN AGENT. The card's input was written by an agent that may have read
 * untrusted text (a Help Center article, the end user's own message), and the
 * end user who taps is not a member of the workspace. A tap is therefore not a
 * workspace person's word: `proposeAction` must treat it as the agent's
 * proposal, which is the only principal kind whose declared gates can hold it
 * (`gateHold`) and whose run waits at the autonomy ladder's approval step.
 * The token's grants and scope are kept, so the grant check is still the
 * token's.
 * @param tokenPrincipal - The token's principal.
 * @param agentSlug - The agent that put the card up.
 */
export function cardTapPrincipal(tokenPrincipal: Principal, agentSlug: string): Principal {
  return { ...tokenPrincipal, kind: 'agent', id: `agent:${agentSlug}`, autonomy: 2 };
}

/**
 * Propose the card's action for one tap, then record the tap on the card.
 * Runs under the card's lock.
 * @param tap - The tap and its card.
 */
async function proposeCardTap(tap: CardTap): Promise<ProposeResult> {
  const ran = await proposeEndUserRun(tap);
  await recordCardTap({ orgId: tap.orgId, conversationId: tap.conversationId, cardId: tap.cardId, caller: tap.caller, ran });
  return ran;
}

/**
 * Propose an action for an end user's tap. Run it under the tap's lock
 * ({@link withCardLock}).
 *
 * The proposal is the agent's, with the confidence the tap carries: the one
 * the agent wrote on the card, or 1 for a Talk to a person tap
 * (`origin.byPerson` is false: nobody in the workspace has said yes). So the
 * action's declared gates and holds apply, and the autonomy ladder decides: at
 * `execute-with-approval` the run waits in Review for a workspace person and
 * this returns `pending` without running anything; the action runs at once
 * only where the ladder lets an agent's proposal run on its own (a rung that
 * automates, with the agent's confidence at or above its floor). A card the
 * agent gave no confidence for is held for a person at every rung. The end user
 * rides along as `origin.caller`, so the action still gets them as
 * `ctx.caller` when a person approves the run later.
 * @param tap - The proposal.
 */
export async function proposeEndUserRun(tap: EndUserProposal): Promise<ProposeResult> {
  let ran;
  try {
    ran = await proposeAction({
      orgId: tap.orgId,
      actionId: tap.actionId,
      input: tap.input,
      principal: cardTapPrincipal(tap.tokenPrincipal, tap.agentSlug),
      invokedBy: tap.actorId,
      proposal: {
        agentSlug: tap.agentSlug,
        ...(tap.rationale ? { rationale: tap.rationale } : {}),
        ...(typeof tap.confidence === 'number' ? { confidence: tap.confidence } : {}),
        suggestedDecision: null,
        suggestedDecisionReason: null,
      },
      dedupKey: tap.dedupKey,
      origin: { conversationId: tap.conversationId, userId: tap.actorId, byPerson: false, caller: tap.caller },
      // `proposeAction` only asks the ladder about an agent's proposal that carries a
      // confidence; without one a plain action would run at once at any rung. A card
      // the agent gave no confidence for is held for a person instead.
      ...(typeof tap.confidence === 'number' ? {} : { hold: CARD_WITHOUT_CONFIDENCE_HOLD }),
    });
  } catch (error) {
    if (error instanceof ActionError) {
      throw new WorkspaceCardError(error.code, error.code === 'RETURNED_FOR_REVISION' ? CARD_RETURNED_MESSAGE : error.message);
    }
    throw error;
  }
  return ran;
}

/**
 * Bind the card to the end user of its first tap, or refuse a tap by anyone else.
 * Runs under the card's lock, so the check and the write cannot be raced. Also
 * re-judges the card's state ({@link cardUnavailableReason}): the check before
 * the lock can be stale by the time a waiting tap gets it, and the bind write is
 * only made while the card is still in the state read here.
 *
 * WHY. A tap whose run is still `pending` or has `failed` is proposed again under
 * the same key, and the action service's refresh rewrites the stored proposal,
 * `origin.caller` included. Without this, a second end user tapping a card the
 * first one left waiting would swap themselves onto the run, and a person
 * approving it in Review would run the agent's input for the first user's
 * conversation as the second user. The binding is written before anything is
 * proposed, whatever that tap comes to (pending, done or failed).
 * @param tap - The tap and its card.
 */
async function bindCardToCaller(tap: CardTap): Promise<void> {
  const stored = await readCardRun({ orgId: tap.orgId, conversationId: tap.conversationId, cardId: tap.cardId });
  if (!stored) {
    throw new WorkspaceCardError('CARD_NOT_AVAILABLE', `Card ${tap.cardId} can no longer be run: it is no longer on the conversation.`);
  }
  // The pre-lock check in `runWorkspaceCard` is stale by now: while this tap
  // waited for the lock, the card may have been filed, deferred or expired. A
  // card an earlier tap already ran (`decided`) passes, and the dedup answers
  // with that run.
  const storedState = stored.state ?? 'proposed';
  const unavailable = cardUnavailableReason(storedState, stored);
  if (unavailable) {
    throw new WorkspaceCardError('CARD_NOT_AVAILABLE', `Card ${tap.cardId} can no longer be run: ${unavailable}.`);
  }
  if (stored.tappedBy === tap.caller.id) {
    return;
  }
  if (stored.tappedBy) {
    throw new WorkspaceCardError('CARD_NOT_AVAILABLE', `Card ${tap.cardId} can no longer be run: it was already tapped by another caller.`);
  }
  const bound = await markCardRun({ orgId: tap.orgId, conversationId: tap.conversationId, cardId: tap.cardId, expectState: storedState === 'decided' ? 'decided' : 'proposed', patch: { tappedBy: tap.caller.id } });
  if (!bound) {
    throw new WorkspaceCardError('CARD_NOT_AVAILABLE', `Card ${tap.cardId} can no longer be run: it is no longer on the conversation.`);
  }
}

/**
 * One tap's work under the card's lock: bind the card to its first caller, then propose.
 * @param tap - The tap and its card.
 */
async function tapUnderLock(tap: CardTap): Promise<ProposeResult> {
  await bindCardToCaller(tap);
  return proposeCardTap(tap);
}

/**
 * The end user as the action's own caller rules read them, or CALLER_INVALID.
 * @param cardRunnable - The action's end-user settings.
 * @param caller - The caller as the app sent it.
 */
export function endUserCaller(cardRunnable: NonNullable<ReturnType<typeof cardRunnableOf>>, caller: unknown): ActionCaller {
  const callerCheck = cardRunnable.callerSchema.safeParse(caller);
  if (!callerCheck.success) {
    throw new WorkspaceCardError('CALLER_INVALID', `caller: ${callerCheck.error.issues.map(issue => `${issue.path.join('.') || 'caller'}: ${issue.message}`).join('; ')}`);
  }
  return callerCheck.data;
}

/**
 * Run the registered action behind a card the end user tapped.
 *
 * One card, one run (see the module comment): a second tap, or two taps at once,
 * make one run; the later call gets that run back with outcome `already_decided`
 * (or `refreshed` while it is still `pending`), or `already_underway` when it
 * could not wait for the other tap to finish. Whether the first tap RAN the
 * action is the ladder's call, not the tap's: see `proposeCardTap`.
 *
 * Refuses, as a {@link WorkspaceCardError} with nothing run: a conversation
 * this workspace does not own (`CONVERSATION_NOT_FOUND`), a card that is not on
 * it or was not minted for an end user (`CARD_NOT_FOUND`), a card that can no
 * longer be run (`CARD_NOT_AVAILABLE`: filed to Review, deferred, expired,
 * never put up, or already tapped by a different caller: see {@link bindCardToCaller}), a stored end-user card whose action is no longer registered, or is no longer
 * card-runnable (`CARD_NOT_RUNNABLE`: the action was removed or changed after
 * the card was put up; a turn never marks such a card for an end user),
 * an action the workspace has turned off (`ACTION_DISABLED`), a card still
 * waiting on its draft (`CARD_NEEDS_DRAFT`), input that no longer passes the
 * action's schema or that carries the reserved caller key (`CARD_INPUT_INVALID`),
 * a caller the action's own schema rejects (`CALLER_INVALID`), and whatever the
 * action service refuses (`FORBIDDEN` for a token without the action's grant,
 * `VALIDATION_FAILED`, ...). An action that ran and failed is NOT a refusal:
 * it comes back as `status: 'failed'` with the run id, so the app can say so.
 * @param input - The tap.
 */
export async function runWorkspaceCard(input: RunWorkspaceCardInput): Promise<RunWorkspaceCardResult> {
  const { orgId, conversationId, cardId } = input;
  // The same door ask_workspace uses to continue a conversation.
  const conversation = await getConversation({ orgId, id: conversationId });
  if (!conversation) {
    throw new WorkspaceCardError('CONVERSATION_NOT_FOUND', `No conversation ${conversationId} in this workspace.`);
  }
  const card = await readCardRun({ orgId, conversationId, cardId });
  // A card without the end-user marker is one the dashboard chat drew for a
  // member of the workspace: not this call's to run, and not to be told apart
  // from a card that does not exist.
  if (!card?.endUser) {
    throw new WorkspaceCardError('CARD_NOT_FOUND', `No card ${cardId} was put up for an end user in conversation ${conversationId}.`);
  }
  const unavailable = cardUnavailableReason(card.state ?? 'proposed', card);
  if (unavailable) {
    throw new WorkspaceCardError('CARD_NOT_AVAILABLE', `Card ${cardId} can no longer be run: ${unavailable}.`);
  }
  const action = getAction(card.actionId);
  const cardRunnable = action && cardRunnableOf(action);
  if (!action || !cardRunnable) {
    throw new WorkspaceCardError('CARD_NOT_RUNNABLE', `The action behind card ${cardId} (${card.actionId}) is no longer available to run from a card. Tell the user this cannot be done from the card.`);
  }
  const cardInput = card.input ?? {};
  if (!(await cardActionEnabled(orgId, action.id, cardInput))) {
    throw new WorkspaceCardError('ACTION_DISABLED', `${action.id} is turned off for this workspace.`);
  }
  if (card.draft) {
    throw new WorkspaceCardError('CARD_NEEDS_DRAFT', `Card ${cardId} is waiting on its draft: send its draft prompt through ask_workspace first (${card.draft.missing}).`);
  }
  const checked = checkCardInput(action, cardInput);
  if (!checked.ok) {
    throw new WorkspaceCardError('CARD_INPUT_INVALID', `Card ${cardId} cannot run: ${checked.problem}.`);
  }
  const caller = endUserCaller(cardRunnable, input.caller);

  const dedupKey = workspaceCardDedupKey(action.id, conversationId, cardId);
  const tap: CardTap = { orgId, actionId: action.id, agentSlug: conversation.agentSlug, rationale: card.rationale, confidence: card.confidence, conversationId, cardId, dedupKey, actorId: input.actorId, tokenPrincipal: input.principal, input: checked.input, caller };
  const tapped = await withCardLock(`run_workspace_card:${orgId}:${dedupKey}`, () => tapUnderLock(tap));
  // Another tap on this card held the lock for the whole wait: nothing ran here.
  const ran: ProposeResult = tapped?.value ?? { runId: 0, status: 'pending', outcome: 'already_underway', underway: { line: 'Another tap on this card is running it right now. Tap again in a moment to see its result.' } };
  return {
    conversationId,
    cardId,
    actionId: action.id,
    runId: ran.runId,
    status: ran.status,
    outcome: ran.outcome,
    result: ran.result ?? null,
    ...failureAnswer(ran),
    ...(ran.underway ? { underway: { line: ran.underway.line } } : {}),
  };
}

/** The fixed text a failed tap answers with: one for a failure, one for a failure that is safe to repeat. */
export type TapFailureWording = { failed: string; retryable: string };

/** A card tap's failure text. */
const CARD_FAILURE_WORDING: TapFailureWording = { failed: CARD_RUN_FAILED_MESSAGE, retryable: CARD_RUN_RETRYABLE_MESSAGE };

/**
 * The fixed text, and the Try again flag, for a tap whose run failed; nothing when it did not.
 * Whether Try again runs it again is the action service's call (`canTryAgain`),
 * so the card never offers a retry the next tap would refuse.
 * @param ran - What the action service answered. Its `error` is read here and never passed on.
 * @param wording - The text to answer with: a card's by default; a tap with no card names the button instead.
 */
export function failureAnswer(ran: Pick<ProposeResult, 'error' | 'canTryAgain'>, wording: TapFailureWording = CARD_FAILURE_WORDING): Pick<RunWorkspaceCardResult, 'error' | 'retryable'> {
  if (!ran.error) {
    return {};
  }
  return ran.canTryAgain ? { error: wording.retryable, retryable: true } : { error: wording.failed };
}

/**
 * The run id to stamp on the card: none for `already_underway`, which made no run.
 * @param runId - What the action service answered.
 */
function runIdOf(runId: number): { runId?: number } {
  return runId > 0 ? { runId } : {};
}

/**
 * Write what the tap did onto the card, so a reload of the conversation (the
 * dashboard, or `ask_workspace` history) shows the run, not an untouched button.
 * The action has already run by now, so a failure here is logged and never
 * hides its result from the app.
 * @param input - The tap and what it came to.
 * @param input.orgId - The workspace.
 * @param input.conversationId - The conversation.
 * @param input.cardId - The card.
 * @param input.caller - Who tapped.
 * @param input.ran - What `proposeAction` answered.
 */
async function recordCardTap(input: { orgId: string; conversationId: number; cardId: string; caller: ActionCaller; ran: ProposeResult }): Promise<void> {
  const { ran } = input;
  const at = new Date().toISOString();
  // A card that is not done stays `proposed` EXPLICITLY: with a run id and no
  // state, a stored card reads as `filed`, which would shut out the next tap.
  const patch = ran.status === 'done'
    ? { state: 'decided' as const, ...runIdOf(ran.runId), decision: { action: 'run', at, by: `caller:${input.caller.id}` } }
    : { state: 'proposed' as const, ...runIdOf(ran.runId), lastAttempt: { at, reason: ran.status, summary: (ran.error ?? `the run is ${ran.status}`).slice(0, 300) } };
  try {
    // `expectState`: the card is written only while it is still waiting for its
    // tap, so a later tap's answer never overwrites the run an earlier one recorded.
    await markCardRun({ orgId: input.orgId, conversationId: input.conversationId, cardId: input.cardId, expectState: 'proposed', patch });
  } catch (error) {
    console.warn('run_workspace_card: the action ran but the card could not be updated', { conversationId: input.conversationId, cardId: input.cardId, runId: ran.runId }, error);
  }
}
