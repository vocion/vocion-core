/**
 * ActionService — propose → (gate) → execute connector-write actions.
 *
 * The write counterpart to running a skill. An actor (usually an agent
 * teammate, sometimes a human/token) *proposes* an action; authz decides
 * whether it needs approval (external + low autonomy → yes). Gated actions
 * persist as `action_run` (status `pending`) and surface in the unified review
 * queue as the 4th kind; on approval `executeAction` resolves the source's
 * vault credentials and runs the action. Non-gated actions execute immediately
 * and still record their run for the audit trail.
 *
 * No import of ReviewService here — the queue reads `action_run` directly and
 * dispatches back into `executeAction`/`rejectAction`, keeping the dependency
 * one-directional.
 */

import type { SuggestedDecision } from '@/libs/actions/suggestedDecision';
import type { Action } from '@/libs/actions/types';
import type { Principal } from '@/services/authz';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { ZodError } from 'zod';
import { decideExecution } from '@/libs/actions/autoAccept';
import { isManualAction } from '@/libs/actions/manual';
import { isNeverAuto } from '@/libs/actions/neverAuto';
import { policyKeyForRun } from '@/libs/actions/policyKey';
import { getAction } from '@/libs/actions/registry';
import { db } from '@/libs/DB';
import { actionRunSchema, projectSchema } from '@/models/Schema';
import { agentSlugFromPrincipal } from '@/services/adoption/attribution';
import { AuthzDeniedError, enforce } from '@/services/authz';
import { getCredentialsForSource } from '@/services/SourceCredentialService';
import { assertWorkspaceRunning } from '@/services/workspacePause';

export class ActionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
  }
}

/**
 * The state of a single action_run, as any caller sees it.
 *
 * `awaiting_execution` is the hand-off state (`libs/actions/manual.ts`): a
 * person approved the run and the work is now someone's to do outside this
 * process. It is a decided run that is not yet an executed one, and it stays
 * on the open queue until `completeAction` or a rejection closes it.
 */
export type ActionRunResult = {
  runId: number;
  status: 'pending' | 'awaiting_execution' | 'done' | 'failed' | 'rejected' | 'undone';
  result?: Record<string, unknown> | null;
  /** What went wrong, set only when `status` is `failed`. */
  error?: string;
};

/**
 * What a proposal did, so a caller can say it out loud:
 * - `created` — a new run is in the queue (or ran, if the gate let it).
 * - `refreshed` — a pending run already existed and now carries this payload.
 * - `already_decided` — a person judged this exact record before; nothing was
 *   written, and `runId` / `status` / `decidedAt` describe that earlier run.
 *
 * Without this every one of those answered `{ runId, status: 'pending' }` and
 * no consumer could tell a fresh card from a refresh, let alone from one a
 * moderator already threw out.
 */
export type ProposeOutcome = 'created' | 'refreshed' | 'already_decided';

export type ProposeResult = ActionRunResult & {
  outcome: ProposeOutcome;
  /** When the earlier run was decided. Set on `already_decided` only. */
  decidedAt?: Date | null;
};

const DAY_IN_MS = 86_400_000;

/** What blocks a fresh card by default, for an action that opted in at all. */
const DECIDED_STATUSES_THAT_BLOCK = ['done', 'rejected'] as const;

/** A chat card's idempotency key starts with this (`libs/actions/cardDedupKey.ts`). */
export const CARD_DEDUP_PREFIX = 'card:';

/** Every status that means a card's run already happened, or is happening. */
const CARD_STATUSES_THAT_BLOCK = ['done', 'rejected', 'undone', 'executing', 'awaiting_execution'] as const;

/**
 * The envelope as the column holds it: a recommendation is either there with
 * its reason, or the keys are absent. The null a caller passes to say "nothing
 * judged this" never reaches storage.
 */
type StoredProposal<T> = Omit<T, 'suggestedDecision' | 'suggestedDecisionReason'> & {
  suggestedDecision?: SuggestedDecision;
  suggestedDecisionReason?: string;
};

/**
 * What a refresh stores on an open run: the action's own `refresh` result when
 * it has one and that result still parses as the action's input, otherwise the
 * new input and proposal whole.
 * @param action - The action being proposed.
 * @param existing - The open run as read under the lock.
 * @param existing.input - Its stored input.
 * @param existing.proposal - Its stored proposal.
 * @param parsed - The new, parsed input.
 * @param proposal - The new proposal in stored shape.
 */
function storedOnRefresh(
  action: Action,
  existing: { input: unknown; proposal: unknown },
  parsed: Record<string, unknown>,
  proposal: Record<string, unknown> | null,
): { input: Record<string, unknown>; proposal: Record<string, unknown> | null } {
  if (!action.refresh) {
    return { input: parsed, proposal };
  }
  const merged = action.refresh(
    { input: (existing.input ?? {}) as Record<string, unknown>, proposal: (existing.proposal ?? null) as Record<string, unknown> | null },
    { input: parsed, proposal },
  );
  const checked = action.inputSchema.safeParse(merged.input);
  return checked.success
    ? { input: checked.data as Record<string, unknown>, proposal: merged.proposal }
    : { input: parsed, proposal };
}

/**
 * The proposal envelope as it should be stored.
 *
 * A reason belongs to a recommendation. An envelope carrying
 * `suggestedDecisionReason` with no `suggestedDecision` would put a sentence
 * arguing for an outcome on a card that recommends none, and every reader —
 * the review card, the agreement metric, a person scrolling the ledger months
 * later — would have to guess which outcome it argued for. Dropping it is the
 * honest answer: nothing is inferred from it, and nothing is stored that
 * cannot be read.
 * @param proposal - The envelope a caller passed, or undefined.
 */
function proposalForStorage<T extends { suggestedDecision?: SuggestedDecision | null; suggestedDecisionReason?: string | null }>(
  proposal: T | undefined,
): StoredProposal<T> | null {
  if (!proposal) {
    return null;
  }
  if (proposal.suggestedDecision) {
    return proposal as StoredProposal<T>;
  }
  // No recommendation: the reason goes with it, and the null itself is not
  // worth storing — a missing key and a stored null read the same everywhere,
  // and the missing key is what every row written before this looked like.
  const { suggestedDecision: _noDecision, suggestedDecisionReason: _dropped, ...rest } = proposal;
  return rest as StoredProposal<T>;
}

/**
 * The run of this dedup key a person already decided, when the action says a
 * repeat proposal should collapse into it.
 *
 * Only actions carrying `dedupAgainstDecided` look here. For the rest, the
 * dedup key names a target rather than one judged record — `gmail.send` keys
 * on the recipient — and treating a decided run as a match would bar that
 * target for good after a single send.
 * @param orgId
 * @param actionId - Scopes the match: a shared key on another action is not this record.
 * @param dedupKey
 * @param config - The action's `dedupAgainstDecided`, absent when it opted out.
 */
async function findDecidedRunForKey(
  orgId: string,
  actionId: string,
  dedupKey: string,
  config: Action['dedupAgainstDecided'],
): Promise<{ id: number; status: 'done' | 'failed' | 'rejected'; decidedAt: Date } | undefined> {
  // A chat card's own key (`card:…`, `cardDedupKey`) is an idempotency key:
  // one card, one run, whatever its status. The card proposes itself when it
  // mounts under done-for-you, and it mounts again when the streamed turn is
  // swapped for the stored one — on 2026-09-25 (walk 20) every such card filed
  // its ask twice, both executed, because an executed run matched neither the
  // open-run refresh nor a decided-run rule the action had not opted into.
  const cardKey = dedupKey.startsWith(CARD_DEDUP_PREFIX);
  if (!config && !cardKey) {
    return undefined;
  }
  const statuses = cardKey
    ? [...CARD_STATUSES_THAT_BLOCK]
    : config?.statuses ?? [...DECIDED_STATUSES_THAT_BLOCK];
  const [row] = await db
    .select({
      id: actionRunSchema.id,
      status: actionRunSchema.status,
      decidedAt: actionRunSchema.decidedAt,
      executedAt: actionRunSchema.executedAt,
      createdAt: actionRunSchema.createdAt,
    })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.actionId, actionId),
      eq(actionRunSchema.dedupKey, dedupKey),
      inArray(actionRunSchema.status, [...statuses]),
    ))
    .orderBy(desc(actionRunSchema.id))
    .limit(1);
  if (!row) {
    return undefined;
  }
  // `decidedAt` is stamped only when a person decided. A run the gate let
  // through carries `executedAt` instead, and `createdAt` is the last resort
  // so the window below always has a date to measure from.
  const decidedAt = row.decidedAt ?? row.executedAt ?? row.createdAt;
  if (!cardKey && config?.reproposeAfterDays !== undefined) {
    const staleAt = decidedAt.getTime() + config.reproposeAfterDays * DAY_IN_MS;
    if (Date.now() >= staleAt) {
      return undefined;
    }
  }
  return { id: row.id, status: row.status as 'done' | 'failed' | 'rejected', decidedAt };
}

/**
 * Propose an action. Enforces the actor's grant + autonomy gate. If the gate
 * requires approval, records a `pending` action_run and returns it (it now
 * lives in the review queue). Otherwise executes immediately.
 * @param input
 * @param input.orgId
 * @param input.actionId
 * @param input.input
 * @param input.principal
 * @param input.invokedBy
 * @param input.proposal
 * @param input.proposal.confidence
 * @param input.proposal.rationale
 * @param input.proposal.evidence
 * @param input.proposal.agentSlug
 * @param input.proposal.suggestedDecision
 * @param input.proposal.suggestedDecisionReason - One short sentence for why that recommendation.
 * @param input.proposal.suggestedSnoozeUntil
 * @param input.proposal.labels - Payload field names the proposer wrote as a judgement of its own.
 * @param input.dedupKey
 * @param input.expiresAt
 * @param input.conversationAutonomy
 */
/**
 * `defaults.learningEagerness` for this workspace, or null when it authored
 * none (which reads as the shipped default of 7). A missing project row is
 * not an error here: the dial is a preference, and an action must not fail
 * because nobody set one.
 * @param orgId - The project.
 */
async function learningEagernessFor(orgId: string): Promise<number | null> {
  try {
    const [row] = await db
      .select({ learningEagerness: projectSchema.learningEagerness })
      .from(projectSchema)
      .where(eq(projectSchema.id, orgId))
      .limit(1);
    return row?.learningEagerness ?? null;
  } catch {
    return null;
  }
}

export async function proposeAction(input: {
  orgId: string;
  actionId: string;
  input: Record<string, unknown>;
  principal: Principal;
  invokedBy?: string;
  /**
   * Agent-proposal envelope — confidence (0–1), rationale, evidence uris, and
   * the advisory `suggestedDecision` saying what the agent thinks the reviewer
   * should do with this, with one short sentence for why. The recommendation
   * can only ever keep the proposal in the queue (see the guard below); it is
   * never read as a reason to let one run without a person.
   *
   * Anything that sends an envelope must answer the question, and `null` is a
   * real answer: nothing judged this card. Both fields are required so that a
   * producer cannot forget the question, and both may be null so that a
   * producer with no model in the loop is not pushed into inventing a verdict
   * — a fabricated `approve` scores in the agreement rate as though a model
   * had made it, which flatters the agent for a sentence core wrote. A null
   * pair stores neither field and sits outside that rate.
   *
   * `labels` names the payload fields the proposer wrote as a JUDGEMENT rather
   * than read off its source, so the decision can record what the reviewer did
   * with each of them. Names only, never values.
   */
  proposal?: {
    confidence?: number;
    rationale?: string;
    evidence?: string[];
    agentSlug?: string;
    suggestedDecision: SuggestedDecision | null;
    suggestedDecisionReason: string | null;
    suggestedSnoozeUntil?: string;
    labels?: string[];
    scores?: Record<string, number>;
    matchedRules?: Array<{ id: string; title?: string; text: string; evidence?: string }>;
  };
  /**
   * Upsert key for agent-suggested actions — (object type + id + action slug).
   * If a PENDING action_run already exists for (orgId, dedupKey), it is
   * UPDATED in place (input/proposal/expiry refreshed) instead of duplicated.
   */
  dedupKey?: string;
  /** When this suggestion goes stale (drops from the queue/brief). */
  expiresAt?: Date;
  /**
   * The rung of the conversation this came from, when it came from one. A
   * thread a person set to "ask before acting" keeps its word: nothing from
   * it runs on its own, whatever the kind's policy says.
   */
  conversationAutonomy?: 'ask' | 'act';
}): Promise<ProposeResult> {
  const action = getAction(input.actionId);
  if (!action) {
    throw new ActionError('UNKNOWN_ACTION', `No registered action: ${input.actionId}`);
  }
  // A schema violation (missing `dedupOn`, a payload the type's shape
  // rejects, …) is the caller's mistake, not a server fault. Every caller of
  // `proposeAction` — the agent's `propose_action` tool, the write API, the
  // review router — only ever reads `.message` off whatever this throws, and
  // a raw `ZodError.message` is its issues array JSON-stringified, which
  // buries a carefully worded validation message (see
  // `objects-propose-candidate.ts`'s `superRefine`) inside brace-and-quote
  // noise. Re-throwing as an `ActionError` with the issue text joined plainly
  // is what actually reaches the caller as a sentence they can act on.
  let parsed;
  try {
    parsed = action.inputSchema.parse(input.input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ActionError('VALIDATION_FAILED', error.issues.map(issue => issue.message).join('; '));
    }
    throw error;
  }
  // Canonical dedup: when the proposer passes no key, the action derives one
  // from the parsed input — so an agent proposing the same call twice collapses
  // into the deterministic job's old behaviour instead of stacking queue items.
  const dedupKey = input.dedupKey ?? action.dedupKeyFor?.(parsed);

  // Authorised BEFORE anything is written. The refresh path below updates a
  // pending row and calls the action's `onProposed`, which can touch a domain
  // record — deciding permission after that would let an ungranted caller
  // rewrite what a reviewer is about to decide on.
  let decision;
  try {
    decision = enforce(
      input.principal,
      { kind: 'action', action: action.grant, external: action.external, scope: { orgId: input.orgId } },
      'mutate',
    );
  } catch (e) {
    if (e instanceof AuthzDeniedError) {
      throw new ActionError('FORBIDDEN', `Not allowed to run ${action.id}: ${e.decision.reason}`);
    }
    throw e;
  }

  // The action's own last word, before any row exists. Tenant state the input
  // schema cannot check lives here, and refusing costs the caller nothing but
  // a message it can act on.
  const refusal = await action.precheck?.(
    { orgId: input.orgId, invokedBy: input.invokedBy ?? input.principal.id },
    parsed,
  );
  if (refusal) {
    throw new ActionError('VALIDATION_FAILED', refusal);
  }

  // Upsert-by-key: a re-surfaced owed action updates its existing OPEN row
  // rather than stacking duplicates in the queue. A still-open card always
  // wins — it is the one a moderator can still act on. `failed` counts as
  // open now that failed cards stay in the queue for retry: a fresh proposal
  // supersedes the failed attempt and the card goes back to reviewable.
  //
  // Scoped to this action as well as the key. A caller may pass any
  // `dedupKey` over the API, so two actions can share one; matching on the
  // key alone would rewrite the other action's row with this input and run
  // this action's `onProposed` against a run it does not own.
  if (dedupKey) {
    const refreshed = await db.transaction(async (tx) => {
      const lookup = tx
        .select({ id: actionRunSchema.id, input: actionRunSchema.input, proposal: actionRunSchema.proposal })
        .from(actionRunSchema)
        .where(and(
          eq(actionRunSchema.orgId, input.orgId),
          eq(actionRunSchema.actionId, action.id),
          eq(actionRunSchema.dedupKey, dedupKey),
          inArray(actionRunSchema.status, ['pending', 'failed']),
        ))
        .limit(1);
      // An action that merges into the stored payload reads it under a row
      // lock: a sync proposes several documents at once, and two of them can
      // refresh the same run.
      const [existing] = action.refresh ? await lookup.for('update') : await lookup;
      if (!existing) {
        return null;
      }
      const stored = storedOnRefresh(action, existing, parsed as Record<string, unknown>, proposalForStorage(input.proposal));
      await tx
        .update(actionRunSchema)
        .set({
          status: 'pending',
          error: null,
          input: stored.input,
          proposal: stored.proposal as never,
          expiresAt: input.expiresAt ?? null,
          // The refresh is the completion edge of a regeneration: the new
          // payload landing on the same pending run clears the in-flight
          // stamp, whichever path (scoped turn or full agent pass) produced
          // it, and the card re-enables in place.
          regeneratingSince: null,
          regenerateNote: null,
          // A redraft that landed supersedes whatever failure the last one
          // left on the run.
          regenerateError: null,
          // A refreshed card is open work again, so it carries no decision.
          // A run the ladder approved whose execution failed can be
          // re-proposed on the same dedup key and comes back to `pending`
          // here; leaving the old stamp on it would show a reviewer a pending
          // card that claims an agent already approved it, and would put an
          // undecided run into the auto-approved audit list and the
          // auto-approval count.
          approvedByAgent: null,
          decidedBy: null,
          decidedAt: null,
        })
        .where(eq(actionRunSchema.id, existing.id));
      return { id: existing.id, input: stored.input };
    });
    if (refreshed) {
      // Keep the action's own domain row in step with the refreshed payload.
      // `onProposed` is documented idempotent precisely so it can run here as
      // well as on first creation; without this a re-proposed candidate would
      // show the reviewer a stale record.
      await action.onProposed?.(
        { orgId: input.orgId, invokedBy: input.invokedBy ?? input.principal.id },
        refreshed.input,
        refreshed.id,
      );
      return { runId: refreshed.id, status: 'pending', outcome: 'refreshed' };
    }

    // Nothing open, but a person may have judged this exact record already.
    // Actions that opted in stop here rather than putting the same card back
    // in front of them — a listing page re-read every week would otherwise
    // re-propose everything ever approved or rejected on it.
    //
    // Note what this drops: a payload that changed since the decision is not
    // written anywhere and nobody is told. See `dedupAgainstDecided` in
    // `libs/actions/types.ts` for why that trade is made and what an action
    // can do instead.
    // A key the action itself does not trust — a candidate missing one of
    // its identity fields — must not answer for a record nobody has seen.
    const keyIdentifiesOneRecord = action.dedupAgainstDecided?.keyIsTrustworthy?.(parsed) ?? true;
    const decided = keyIdentifiesOneRecord
      ? await findDecidedRunForKey(input.orgId, action.id, dedupKey, action.dedupAgainstDecided)
      : undefined;
    if (decided) {
      return { runId: decided.id, status: decided.status, outcome: 'already_decided', decidedAt: decided.decidedAt };
    }
  }

  // An AGENT'S proposal that CARRIES A CONFIDENCE is judged by the ladder
  // below — the done-for-you decision (confidence against the kind's bar) is
  // what lets it run at once, never the caller's autonomy alone. Until the
  // first internal kinds (`wiki.write_page`, `plugin.enable`) every registered
  // action was `external: true`, so the authz gate and this rule agreed; an
  // internal kind proposed at working autonomy came back `within-autonomy`
  // and executed at 0.45 confidence past a 0.6 bar (found 2026-09-18). A
  // machine run with no envelope, and a person or token holding the grant,
  // still write within their autonomy as before.
  const gated = decision.gate === 'approve'
    || (input.principal.kind === 'agent' && typeof input.proposal?.confidence === 'number');
  const [run] = await db
    .insert(actionRunSchema)
    .values({
      orgId: input.orgId,
      actionId: action.id,
      input: parsed as Record<string, unknown>,
      status: gated ? 'pending' : 'approved',
      invokedBy: input.invokedBy ?? input.principal.id,
      sourceSlug: action.sourceSlug ?? null,
      proposal: proposalForStorage(input.proposal),
      dedupKey: dedupKey ?? null,
      expiresAt: input.expiresAt ?? null,
    })
    .returning({ id: actionRunSchema.id });

  // Back-link the fresh run onto the domain record it reviews. Runs before the
  // gate resolves so the link exists whether the run stays pending or executes.
  await action.onProposed?.(
    { orgId: input.orgId, invokedBy: input.invokedBy ?? input.principal.id },
    parsed,
    run!.id,
  );

  if (gated) {
    // Never-auto guard (safety invariant): these ALWAYS require an explicit
    // human approve, no matter what trust rules exist.
    //   - an outbound send to a real person (gmail.send, or any external action
    //     carrying the send_email grant) — a misconfigured or over-eager
    //     threshold must never be able to fire an email on its own;
    //   - discovery.review_proposal — approving it starts the follow-up
    //     workflow, which drafts an email in the seller's voice. Supervised v1
    //     means a human confirms every detected discovery call, and that is the
    //     calibration data 020 is built on; auto-approving would both skip the
    //     human and poison the feedback signal.
    //   - personalization.enroll — approving it enrolls a real lead into a
    //     HubSpot sequence that sends real email. No trust rule can release
    //     an enrollment without a human.
    //   - objects.propose_candidate — approving an extracted record is what
    //     lets it be published outside. The whole moderation loop exists so a
    //     human sees every candidate; a confidence threshold that cleared them
    //     automatically would empty the queue without anyone reading it.
    // Deliberately not configurable; revisit only once UC5 trust reporting
    // exists and a human opts in explicitly. Fails safe — it can only keep the
    // item in the review queue, never release it.
    // The list itself lives in `libs/actions/neverAuto.ts` so the autonomy
    // ladder reads the same one and never offers a promotion this gate refuses.
    if (isNeverAuto(action)) {
      return { runId: run!.id, status: 'pending', outcome: 'created' };
    }
    // An agent that recommended anything other than approval does not get to
    // have the trust ladder run its work anyway. Confidence and recommendation
    // answer different questions — an agent can be highly confident that the
    // right call is to turn this down — and a rule keyed on confidence alone
    // would read that as "very sure, go ahead". Fails safe: it can only keep
    // the item in the queue for a person, never release it.
    if (input.proposal?.suggestedDecision === 'reject' || input.proposal?.suggestedDecision === 'snooze') {
      return { runId: run!.id, status: 'pending', outcome: 'created' };
    }
    // Done for you, by default (`libs/actions/autoAccept.ts`): a reversible,
    // low-risk kind runs on its own above its bar; an automating rung runs at
    // its trust rule's floor; everything else — and anything a person has
    // parked or held — waits for a person. The reason is written on the run.
    // The ladder's key for THIS input — the action id, unless the action
    // serves several ledgers (`git.merge` → `git.merge.<riskClass>`). The
    // trust rule, the risk tier and the evidence all live under it.
    const policyKey = policyKeyForRun(action.id, parsed as Record<string, unknown>);
    const { effectivePolicy } = await import('@/services/autonomy/AutonomyService');
    const policy = await effectivePolicy(input.orgId, policyKey);
    // The workspace's appetite for the system improving itself, read only for
    // a kind that declares it (`libs/actions/eagerness.ts`). A trust rule or a
    // promoted policy still wins — `decideExecution` reads the dial on the
    // default branch only, which is the branch nobody has spoken about.
    const learningEagerness = action.selfImproving === true
      ? await learningEagernessFor(input.orgId)
      : null;
    const verdict = decideExecution({
      actionId: policyKey,
      confidence: input.proposal?.confidence,
      // "Reversible" is `undo` for a kind that runs here, and the hand-off's
      // own word for one that runs elsewhere (a pushed branch is deleted with
      // one command; nothing in this process could do it).
      reversible: action.undo !== undefined || action.manual?.reversible === true,
      neverAuto: false,
      suggestedDecision: input.proposal?.suggestedDecision ?? null,
      rung: policy.rung,
      riskTier: policy.riskTier,
      minConfidence: policy.minConfidence,
      explicit: policy.policy !== null || policy.trustRule !== null,
      conversationAutonomy: input.conversationAutonomy,
      selfImproving: action.selfImproving === true,
      learningEagerness,
    });
    if (verdict.mode === 'execute') {
      // Who to credit with the decision. An in-process agent turn stamps
      // `agent:<slug>` on the proposing principal; a proposal made over the API
      // stamps its caller there and names the agent in the envelope instead, so
      // both have to be read. Neither knowing it means the ladder itself is
      // the decider — the honest answer, rather than crediting an agent we
      // cannot name.
      const decidingAgent = agentSlugFromPrincipal(input.invokedBy ?? input.principal.id)
        ?? input.proposal?.agentSlug;
      await db
        .update(actionRunSchema)
        .set({
          proposal: {
            ...(proposalForStorage(input.proposal) ?? {}),
            autoApproved: true,
            autoApprovedThreshold: verdict.threshold ?? undefined,
            autoApprovedReason: verdict.reason,
            autoApprovedBy: verdict.source,
          } as never,
          // `approvedByAgent` is the system of record for who decided; the
          // envelope key above predates it and is kept so runs written before
          // the column landed still read as auto-approved.
          //
          // Stamping the decision fields here is what makes "did a decision
          // happen" one question instead of two: before this, an auto-approved
          // run left `decidedBy` and `decidedAt` empty and was indistinguishable
          // from one nobody had touched.
          approvedByAgent: true,
          decidedBy: decidingAgent ? `agent:${decidingAgent}` : 'trust-ladder',
          decidedAt: new Date(),
        })
        .where(eq(actionRunSchema.id, run!.id));
      // Deliberately NOT written to the adoption stream. Adoption measures what
      // people do, and an agent actor on a `review.%` event would count itself
      // as an active user and as an interaction, inflating the very numbers the
      // screen exists to report. The count comes off this column instead
      // (`AdoptionService.countAutoApprovals`), which is the system of record
      // for the decision and is indexed for exactly that question.
      return { ...await executeAction(run!.id, input.orgId), outcome: 'created' };
    }
    return { runId: run!.id, status: 'pending', outcome: 'created' };
  }
  return { ...await executeAction(run!.id, input.orgId), outcome: 'created' };
}

/**
 * Execute a proposed action (called on approval, or directly for non-gated).
 * Resolves the source's vault credentials, runs the action, records the result.
 * @param runId
 * @param orgId
 * @param opts
 * @param opts.reviewedBy - The human who approved, when it came through review.
 * @param opts.externalRef
 * @param opts.externalRef.system
 * @param opts.externalRef.id
 */
export async function executeAction(
  runId: number,
  orgId: string,
  opts?: {
    reviewedBy?: string;
    /** The downstream record the approver created, to link to the domain row. */
    externalRef?: { system: string; id: string };
  },
): Promise<ActionRunResult> {
  const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, runId)).limit(1);
  if (!run || run.orgId !== orgId) {
    throw new ActionError('NOT_FOUND', `action_run ${runId} not found for org ${orgId}`);
  }
  const action = getAction(run.actionId);
  if (!action) {
    throw new ActionError('UNKNOWN_ACTION', `No registered action: ${run.actionId}`);
  }
  // `pending` is the review queue's approve, `approved` is a run the gate let
  // straight through, and `failed` is a standing approval whose execution
  // threw — retrying it honors the decision rather than overriding one. Only
  // `done` and `rejected` have real outcomes that a re-run would undo.
  if (run.status !== 'pending' && run.status !== 'approved' && run.status !== 'failed') {
    throw new ActionError('INVALID_STATE', `action_run ${runId} is ${run.status} — already decided, cannot execute`);
  }

  // Stamped at the decision, not at completion: even a failed execution
  // was still approved by this person at this moment.
  const decision = opts?.reviewedBy
    ? {
        decidedBy: opts.reviewedBy,
        decidedAt: new Date(),
        // The LAST decider owns the row, so a person executing this makes
        // it a human decision outright — no coalesce.
        //
        // The only run this can overwrite is one an agent approved whose
        // execution then threw and which sits in the queue as `failed`: a
        // `done` or `rejected` run is never re-decided, because the dedup
        // refresh matches only open rows and a later proposal opens a new
        // run instead. So what this reclassifies is precisely the case
        // where the agent did NOT take the work off anyone's plate — it
        // broke and a person finished it — and counting that as an
        // auto-approval overstates what the ladder actually did.
        approvedByAgent: false,
      }
    : {};

  // The workspace off switch. A hand-off is exempt and is checked first: it
  // executes nothing, it hands a person a list of steps to perform by hand,
  // and a person working by hand is not the factory working. Every other kind
  // runs code or calls a model on the workspace's behalf, so it is refused —
  // before the row is moved to `executing`, so a resumed workspace finds the
  // run exactly where the approver left it.
  if (!isManualAction(action)) {
    await assertWorkspaceRunning(orgId, 'gated_action');
  }

  // A hand-off (`libs/actions/manual.ts`) is released, not run: the approval
  // is the decision, the doing is a person's or an outside system's, and the
  // run waits for them to say so. Nothing in-process is called — a manual
  // kind's `execute` exists to refuse, not to be reached.
  if (isManualAction(action)) {
    const releasedAt = new Date();
    const releasedBy = opts?.reviewedBy ?? run.decidedBy ?? 'trust-ladder';
    const result = {
      ...(run.result ?? {}),
      handoff: {
        releasedAt: releasedAt.toISOString(),
        releasedBy,
        ...(opts?.externalRef ? { externalRef: opts.externalRef } : {}),
      },
    };
    await db
      .update(actionRunSchema)
      .set({ status: 'awaiting_execution', result, error: null, ...decision })
      .where(eq(actionRunSchema.id, runId));
    return { runId, status: 'awaiting_execution', result };
  }

  await db
    .update(actionRunSchema)
    .set({ status: 'executing', ...decision })
    .where(eq(actionRunSchema.id, runId));
  const credentials = action.sourceSlug ? await getCredentialsForSource(orgId, action.sourceSlug) : undefined;

  try {
    const result = await action.execute({
      orgId,
      credentials,
      invokedBy: run.invokedBy ?? undefined,
      reviewedBy: opts?.reviewedBy,
      runId,
      externalRef: opts?.externalRef,
    }, run.input);
    await db
      .update(actionRunSchema)
      .set({ status: 'done', result, error: null, executedAt: new Date() })
      .where(eq(actionRunSchema.id, runId));
    // Every self-update, from the one place every self-update lands. A new
    // noun in the class (`libs/actions/selfUpdate.ts`) is therefore in the
    // log, and countable, with no new `track()` call of its own.
    void trackSelfUpdate({ orgId, run, runId, result, mode: opts?.reviewedBy ? 'approved' : 'auto' });
    return { runId, status: 'done', result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(actionRunSchema)
      .set({ status: 'failed', error: message, executedAt: new Date() })
      .where(eq(actionRunSchema.id, runId));
    // The error rides the return so the surface that clicked Approve can SAY
    // the execution failed — a silent failed row cost three days once.
    return { runId, status: 'failed', result: null, error: message };
  }
}

/**
 * Close a hand-off: whoever performed the work says it is done, and the run
 * records who, when, their note and where the result is. Only a run in
 * `awaiting_execution` can be completed — a pending run has not been
 * approved, and a done one already was. `by` is the person or API caller
 * with the `approve` capability who reported it; it need not be the approver.
 * @param runId
 * @param orgId
 * @param opts
 * @param opts.by - Who marked it done.
 * @param opts.note - What they did, or what differed from the recipe.
 * @param opts.resultUrl - Where the outcome lives — the merged PR, the deployment, the post.
 * @param opts.externalRef - The record in the performing system, when the reporter has one.
 * @param opts.externalRef.system
 * @param opts.externalRef.id
 */
export async function completeAction(
  runId: number,
  orgId: string,
  opts: { by: string; note?: string; resultUrl?: string; externalRef?: { system: string; id: string } },
): Promise<ActionRunResult> {
  const [run] = await db.select().from(actionRunSchema).where(and(eq(actionRunSchema.id, runId), eq(actionRunSchema.orgId, orgId))).limit(1);
  if (!run) {
    throw new ActionError('NOT_FOUND', `action_run ${runId} not found for org ${orgId}`);
  }
  const action = getAction(run.actionId);
  if (!action) {
    throw new ActionError('UNKNOWN_ACTION', `No registered action: ${run.actionId}`);
  }
  if (!isManualAction(action)) {
    throw new ActionError('INVALID_STATE', `${run.actionId} runs here when approved — there is nothing to mark done by hand`);
  }
  if (run.status !== 'awaiting_execution') {
    throw new ActionError(
      'INVALID_STATE',
      run.status === 'pending'
        ? `action_run ${runId} has not been approved yet — approve it first, then mark it done`
        : `action_run ${runId} is ${run.status} — only a released hand-off can be marked done`,
    );
  }
  const executedAt = new Date();
  const result = {
    ...(run.result ?? {}),
    executed: {
      at: executedAt.toISOString(),
      by: opts.by,
      ...(opts.note?.trim() ? { note: opts.note.trim() } : {}),
      ...(opts.resultUrl?.trim() ? { resultUrl: opts.resultUrl.trim() } : {}),
      ...(opts.externalRef ? { externalRef: opts.externalRef } : {}),
    },
  };
  await db
    .update(actionRunSchema)
    .set({ status: 'done', result, error: null, executedAt })
    .where(eq(actionRunSchema.id, runId));
  return { runId, status: 'done', result };
}

/**
 * Overwrite a PENDING action's input — the operator edited the draft in the
 * review queue before approving (edit-then-approve). Re-validates against the
 * action's own input schema so an edit can never smuggle a malformed payload
 * into execution. No-op-safe: only touches rows still `pending` for this org.
 * @param runId
 * @param orgId
 * @param input - The edited payload (same shape the action expects).
 */
export async function updateActionInput(runId: number, orgId: string, input: Record<string, unknown>): Promise<void> {
  const [run] = await db.select().from(actionRunSchema).where(and(eq(actionRunSchema.id, runId), eq(actionRunSchema.orgId, orgId))).limit(1);
  if (!run) {
    throw new ActionError('NOT_FOUND', `action_run ${runId} not found for org ${orgId}`);
  }
  if (run.status !== 'pending') {
    throw new ActionError('INVALID_STATE', `action_run ${runId} is ${run.status}, not pending — cannot edit`);
  }
  const action = getAction(run.actionId);
  const parsed = action ? action.inputSchema.parse(input) : input;
  await db
    .update(actionRunSchema)
    .set({ input: parsed as Record<string, unknown> })
    .where(eq(actionRunSchema.id, runId));

  // The edit has to reach the action's own domain row too. Without this an
  // edit-then-approve executes on the corrected payload while the record the
  // reviewer's decision is kept as still holds the original — the same drift
  // the dedup-refresh path guards against, and `onProposed` is documented
  // idempotent so it is safe to run again here.
  await action?.onProposed?.(
    { orgId, invokedBy: run.invokedBy ?? undefined },
    parsed,
    runId,
  );
}

/**
 * Reject a pending action (from the review queue) — never executes. The
 * action's `onRejected` hook runs after the flip so the domain record it
 * back-links can move lanes with the decision (fail-soft: the rejection
 * stands even if the hook fails). A released hand-off (`awaiting_execution`)
 * is rejected the same way when it could not be done — the reason is what
 * the person who tried found.
 * @param runId
 * @param orgId
 * @param reason
 * @param opts
 * @param opts.reviewedBy - The human who declined, when it came through review.
 */
export async function rejectAction(runId: number, orgId: string, reason?: string, opts?: { reviewedBy?: string }): Promise<void> {
  const [run] = await db
    .update(actionRunSchema)
    .set({
      status: 'rejected',
      error: reason ?? null,
      executedAt: new Date(),
      decidedBy: opts?.reviewedBy ?? null,
      decidedAt: new Date(),
      // A rejection is a decision, and it is never an agent's — the trust
      // ladder can only release work, never turn it down. The last decider
      // owns the row, so rejecting a run an agent approved makes it a human
      // decision: the agent's call did not stand, and a column that still read
      // `true` would count a rejected proposal towards what the ladder got
      // through on its own.
      approvedByAgent: false,
    })
    .where(and(eq(actionRunSchema.id, runId), eq(actionRunSchema.orgId, orgId)))
    .returning({ actionId: actionRunSchema.actionId, input: actionRunSchema.input, invokedBy: actionRunSchema.invokedBy });
  if (!run) {
    return;
  }
  const action = getAction(run.actionId);
  await action?.onRejected?.(
    { orgId, invokedBy: run.invokedBy ?? undefined, reviewedBy: opts?.reviewedBy },
    run.input,
    runId,
    reason,
  ).catch((err) => {
    console.error(`[ActionService] onRejected hook for "${run.actionId}" failed`, err);
  });
}

/**
 * Put a DONE run back — the other half of "done for you". The action's own
 * `undo` restores what `execute` recorded; the run becomes `undone` and the
 * person who undid it owns the decision. An undo of a run the ladder released
 * on its own is the strongest signal that the release was wrong, so the kind
 * is held at approval (or demoted, if it had been promoted) —
 * `AutonomyService.holdAfterUndo`.
 * @param runId
 * @param orgId
 * @param opts
 * @param opts.by - The person undoing it.
 */
export async function undoAction(runId: number, orgId: string, opts: { by: string }): Promise<ActionRunResult> {
  const [run] = await db.select().from(actionRunSchema).where(and(eq(actionRunSchema.id, runId), eq(actionRunSchema.orgId, orgId))).limit(1);
  if (!run) {
    throw new ActionError('NOT_FOUND', `action_run ${runId} not found for org ${orgId}`);
  }
  const action = getAction(run.actionId);
  if (!action) {
    throw new ActionError('UNKNOWN_ACTION', `No registered action: ${run.actionId}`);
  }
  if (!action.undo) {
    throw new ActionError('NOT_REVERSIBLE', `${run.actionId} cannot be undone — it is why this kind always asks first.`);
  }
  if (run.status !== 'done') {
    throw new ActionError('INVALID_STATE', `action_run ${runId} is ${run.status} — only a done run can be undone`);
  }
  const credentials = action.sourceSlug ? await getCredentialsForSource(orgId, action.sourceSlug) : undefined;
  const wasAuto = run.approvedByAgent === true;
  const confidence = typeof run.proposal?.confidence === 'number' ? run.proposal.confidence : null;
  let undoResult: Record<string, unknown> | void;
  try {
    undoResult = await action.undo({ orgId, credentials, invokedBy: run.invokedBy ?? undefined, reviewedBy: opts.by, runId }, run.input, run.result ?? {});
  } catch (err) {
    throw new ActionError('UNDO_FAILED', err instanceof Error ? err.message : String(err));
  }
  await db
    .update(actionRunSchema)
    .set({
      status: 'undone',
      result: { ...(run.result ?? {}), undo: { at: new Date().toISOString(), by: opts.by, ...(undoResult ?? {}) } },
      // The last decider owns the row: a person undid what an agent released,
      // so this is no longer counted among what the ladder got through.
      approvedByAgent: false,
      decidedBy: opts.by,
      decidedAt: new Date(),
    })
    .where(eq(actionRunSchema.id, runId));
  void trackSelfUpdateUndone({ orgId, run, runId, by: opts.by });
  if (wasAuto) {
    const { holdAfterUndo } = await import('@/services/autonomy/AutonomyService');
    await holdAfterUndo({ orgId, actionId: run.actionId, confidence, by: opts.by }).catch((err) => {
      console.error(`[ActionService] holdAfterUndo after undo of "${run.actionId}" failed`, err);
    });
  }
  return { runId, status: 'undone', result: run.result ?? null };
}

/* ------------------------------------------------------------------ */
/* The self-improvement class, in the log                              */
/* ------------------------------------------------------------------ */

/**
 * Put one executed self-update on the adoption stream. Never throws and
 * never blocks the run: a missing log line is not worth failing a write that
 * already happened.
 * @param opts - The run that just executed.
 * @param opts.orgId
 * @param opts.run - The stored row (for its input and who invoked it).
 * @param opts.run.actionId
 * @param opts.run.input
 * @param opts.run.invokedBy
 * @param opts.run.proposal
 * @param opts.runId
 * @param opts.result - What `execute` returned.
 * @param opts.mode - `auto` when the ladder released it, `approved` when a person did.
 */
async function trackSelfUpdate(opts: {
  orgId: string;
  run: { actionId: string; input: Record<string, unknown>; invokedBy: string | null; proposal?: { agentSlug?: string } | null };
  runId: number;
  result: Record<string, unknown>;
  mode: 'auto' | 'approved';
}): Promise<void> {
  try {
    const { isSelfUpdate, selfUpdateReceipt, selfUpdateLineCounts } = await import('@/libs/actions/selfUpdate');
    if (!isSelfUpdate(opts.run.actionId)) {
      return;
    }
    const receipt = selfUpdateReceipt({ actionId: opts.run.actionId, runId: opts.runId, status: 'applied', input: opts.run.input, result: opts.result });
    if (!receipt) {
      return;
    }
    const { track } = await import('@/services/adoption/track');
    await track({ orgId: opts.orgId, userId: opts.run.invokedBy ?? 'system' }, 'learning.self_updated', {
      agentSlug: opts.run.proposal?.agentSlug ?? agentSlugFromInvoker(opts.run.invokedBy),
      resource: ['action_run', opts.runId],
      meta: { noun: receipt.noun, mode: opts.mode, target: receipt.target.slice(0, 120), ...selfUpdateLineCounts(opts.result) },
    });
  } catch (err) {
    console.error(`[ActionService] could not log the self-update on run ${opts.runId}`, err);
  }
}

/**
 * Put one undone self-update on the same stream — the count against
 * `learning.self_updated` is how a person sees whether the eagerness is
 * earning its keep.
 * @param opts - The run that was just put back.
 * @param opts.orgId
 * @param opts.run
 * @param opts.run.actionId
 * @param opts.run.input
 * @param opts.run.result
 * @param opts.run.proposal
 * @param opts.runId
 * @param opts.by - The person who undid it.
 */
async function trackSelfUpdateUndone(opts: {
  orgId: string;
  run: { actionId: string; input: Record<string, unknown>; result: Record<string, unknown> | null; proposal?: { agentSlug?: string } | null };
  runId: number;
  by: string;
}): Promise<void> {
  try {
    const { isSelfUpdate, selfUpdateReceipt } = await import('@/libs/actions/selfUpdate');
    if (!isSelfUpdate(opts.run.actionId)) {
      return;
    }
    const receipt = selfUpdateReceipt({ actionId: opts.run.actionId, runId: opts.runId, status: 'applied', input: opts.run.input, result: opts.run.result });
    if (!receipt) {
      return;
    }
    const { track } = await import('@/services/adoption/track');
    await track({ orgId: opts.orgId, userId: opts.by }, 'learning.self_update_undone', {
      agentSlug: opts.run.proposal?.agentSlug ?? null,
      resource: ['action_run', opts.runId],
      meta: { noun: receipt.noun, target: receipt.target.slice(0, 120) },
    });
  } catch (err) {
    console.error(`[ActionService] could not log the undo of run ${opts.runId}`, err);
  }
}

/**
 * `agent:<slug>` → `<slug>`, so an agent's own self-updates are attributed to it.
 * @param invokedBy
 */
function agentSlugFromInvoker(invokedBy: string | null | undefined): string | undefined {
  return invokedBy?.startsWith('agent:') ? invokedBy.slice(6) : undefined;
}
