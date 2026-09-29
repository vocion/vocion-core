/**
 * propose_action — the agent's hands, safely.
 *
 * Lets an agent propose a registered connector-write action (hubspot.update,
 * gmail.send, …) with a PROPOSAL ENVELOPE: confidence (0–1), rationale,
 * evidence (doc uris), and the advisory recommendation — approve, reject or
 * snooze — of what the agent thinks the reviewer should do with it. The
 * recommendation is measured against the decision a person actually takes; it
 * never releases work on its own. The action rides the full authz gate: external writes
 * at working autonomy land as `pending` action_runs in the unified review
 * queue for human approval — the agent recommends; a person decides. Approved
 * proposals execute with vault credentials; decisions later feed the trust
 * ladder (recommended → automated).
 */

import type { RuntimeContext } from '../types';
import type { SuggestedDecision } from '@/libs/actions/suggestedDecision';
import { tool } from '@langchain/core/tools';
import { explainProposeActionMiss, normalizeProposeActionArgs, proposeActionArgsSchema } from '@/libs/actions/proposeActionArgs';
import { listActions } from '@/libs/actions/registry';
import { parseSuggestedDecisionReason } from '@/libs/actions/suggestedDecision';
import { ActionError, proposeAction, willExecuteOnItsOwn } from '@/services/ActionService';
import { deriveRecommendationDedupKey } from '@/services/chat/autoPropose';
import { readsThisTurn } from '@/services/gates/turnReads';
import { checkProposalBudget, IDEA_ACTION_ID, isAgentsOwnSchedule, isFactoryStep } from '@/services/proposals/ProposalBudgetService';
import { emitSelfUpdate } from '../selfUpdateEvent';
import { withArgumentRepair } from '../toolCallRecord';

/**
 * The record a DONE proposal created, when the action says which: its id,
 * type and title (objects.propose_candidate returns all three).
 * @param result - The action's result.
 */
export function createdRecordOf(result: unknown): { id: number | string; objectType: string; title?: string } | null {
  const r = result as { objectId?: unknown; objectType?: unknown; title?: unknown } | null | undefined;
  if (!r || (typeof r.objectId !== 'number' && typeof r.objectId !== 'string') || typeof r.objectType !== 'string') {
    return null;
  }
  return { id: r.objectId, objectType: r.objectType, title: typeof r.title === 'string' ? r.title : undefined };
}

/** What one proposal asks for, whichever tool made it. */
type ProposalRequest = {
  actionId: string;
  input: Record<string, unknown>;
  confidence: number;
  rationale: string;
  evidence?: string[];
  suggestedDecision: SuggestedDecision;
  suggestedDecisionReason: string;
  suggestedSnoozeUntil?: string;
};

/**
 * Propose one action on the agent's authority and say, in words the model
 * acts on, what happened. The one path `propose_action` and every typed
 * `file_<type>` tool share: the proposal budget, the full authz gate, the
 * trust key, the review queue, and the DONE answer that names the record it
 * made with its link.
 * @param ctx - The turn.
 * @param req - The proposal.
 * @param opts - How this caller differs.
 * @param opts.tool - The tool name progress events carry.
 * @param opts.refused - The answer for a refused proposal (ActionError).
 */
export async function runProposal(
  ctx: RuntimeContext,
  req: ProposalRequest,
  opts: { tool: string; refused?: (code: string, message: string) => string },
): Promise<string> {
  const { actionId: action_id, input: action_input, confidence, rationale, evidence, suggestedDecision: suggested_decision, suggestedDecisionReason: reason, suggestedSnoozeUntil: suggested_snooze_until } = req;
  // Structural, not the model's say-so: this turn is the factory's own step
  // (planning, recovery, intake) when the mission run it belongs to was
  // started in that name (`isFactoryStep`), never by asking what the model
  // is filing. Scoped to the idea filing itself (`objects.propose_candidate`
  // — a plan, a card): every other action a model might call from the same
  // turn is still stamped `agent:<slug>`, so `factory.approve_plan`'s guard
  // against an agent proposing its own approval (#845) is unaffected.
  const factoryStep = isFactoryStep(ctx) && action_id === IDEA_ACTION_ID;
  // THE PROPOSAL BUDGET. An agent on its own schedule may hold only so
  // many undecided items in Review; past that it withdraws one of its
  // own before it files another. A person's own turn is never counted.
  if (ctx.agentSlug && isAgentsOwnSchedule(ctx)) {
    // Only what would wait for a person counts against the Review limit.
    const queuesForPerson = !(await willExecuteOnItsOwn({ orgId: ctx.orgId, actionId: action_id, input: action_input, principal: { kind: 'agent', id: `agent:${ctx.agentSlug}`, scope: { orgId: ctx.orgId }, grants: ['*'], autonomy: 2 }, proposal: { confidence, suggestedDecision: suggested_decision } }).catch(() => false));
    const verdict = await checkProposalBudget({ orgId: ctx.orgId, agentSlug: ctx.agentSlug, actionId: action_id, queuesForPerson, factoryStep });
    if (!verdict.ok) {
      return verdict.message;
    }
  }
  // What this turn has read, for a gate that asks for a source read in it
  // (`readThisTurn`: a feature request names the product's capabilities page).
  const turn = action_id === 'objects.propose_candidate' ? { reads: await readsThisTurn(ctx) } : undefined;
  try {
    const res = await proposeAction({
      orgId: ctx.orgId,
      actionId: action_id,
      input: action_input,
      ...(turn ? { turn } : {}),
      // Same key the review router and the auto-proposer derive, so the
      // second proposal for the same target refreshes the first instead of
      // stacking beside it (2026-09-18: runs 768 and 769, one deal, both
      // pending). Absent, ActionService dedupes on nothing.
      dedupKey: deriveRecommendationDedupKey(action_id, action_input),
      principal: {
        kind: 'agent',
        id: ctx.agentSlug ? `agent:${ctx.agentSlug}` : 'agent:unknown',
        scope: { orgId: ctx.orgId },
        grants: ['*'],
        // Working autonomy: external writes always gate to human approval.
        autonomy: 2,
      },
      // A factory step is stamped `factory:<slug>`, never `agent:<slug>`, so
      // it never lands in this seat's own weekly idea count (which reads
      // `agent:<slug>` alone) — `openProposals`/`withdrawProposal` still find
      // it under either stamp (`seatInvokedBy`).
      invokedBy: ctx.agentSlug ? `${factoryStep ? 'factory' : 'agent'}:${ctx.agentSlug}` : ctx.userId,
      // The thread and the person whose turn it was, so a record this
      // files can say it was asked for (a P1 filed in chat starts its build).
      origin: ctx.conversationId ? { conversationId: ctx.conversationId, userId: ctx.userId ?? null, byPerson: !isAgentsOwnSchedule(ctx) } : undefined,
      proposal: {
        confidence,
        rationale,
        evidence,
        // `invokedBy` cannot always answer "which agent's judgement is this"
        // once it carries `factory:<slug>` instead of `agent:<slug>` — the
        // team report and adoption stream fall back to this field exactly
        // as they already do for a token/API-invoked proposal.
        agentSlug: ctx.agentSlug,
        suggestedDecision: suggested_decision,
        suggestedDecisionReason: reason,
        suggestedSnoozeUntil: suggested_snooze_until,
      },
    });
    ctx.emit({
      type: 'tool_progress',
      tool: opts.tool,
      meta: { runId: res.runId, status: res.status, outcome: res.outcome },
    } as never);
    // A self-improvement kind also says so in the transcript, where the
    // work happened, with Undo on the chip.
    emitSelfUpdate(ctx, { actionId: action_id, input: action_input, res });
    // Each outcome reads differently on purpose. An agent that re-reads a
    // page has to be able to tell a person "nothing new here" — with one
    // shared sentence it would report every second pass as fresh work.
    if (res.outcome === 'already_decided') {
      const decidedOn = res.decidedAt ? ` on ${res.decidedAt.toISOString().slice(0, 10)}` : '';
      return `Not proposed: a person already decided this exact record${decidedOn} — action run #${res.runId} is ${res.status}. Nothing was queued and nothing changed. Do not propose it again; move on to records nobody has judged yet.`;
    }
    if (res.outcome === 'refreshed') {
      return `Action run #${res.runId} for ${action_id} was updated in place — it was already waiting for approval, and now carries this payload (confidence ${confidence}). No new review item was created. Do NOT claim the change was made.`;
    }
    if (res.status === 'pending') {
      return `Proposed ${action_id} → action run #${res.runId} is PENDING human approval in the review queue (confidence ${confidence}). Do NOT claim the change was made — say it has been queued for approval.`;
    }
    // A DONE THAT MADE A RECORD SAYS WHICH, WITH ITS LINK. Conversation
    // 349 (2026-09-28): a request filed within bounds came back as a run
    // number and a JSON blob, and the agent told the person "approving it
    // is what writes the record" — about a record that already existed.
    // The id and the page it opens on are the answer; the link also goes
    // up as a typed event, so the turn links it even if the model does not.
    const created = createdRecordOf(res.result);
    if (created) {
      const { recordHref } = await import('@/services/objects/recordHref');
      const href = await recordHref(ctx.orgId, { objectType: created.objectType, id: created.id }).catch(() => undefined);
      const name = `${created.objectType.replace(/_/g, ' ')} #${created.id}`;
      if (href) {
        ctx.emit({ type: 'record_created', record: { type: 'object', id: String(created.id), label: created.title ? `${name} — ${created.title}` : name, href } });
      }
      return `${action_id} is DONE: filed as ${name} (run #${res.runId}, confidence ${confidence})${href ? `, open at ${href}` : ''}.${created.title ? ` Title: ${created.title}.` : ''} It was within bounds, so it ran without waiting — the record exists now; no approval is pending. Tell the person it is filed as ${name}${href ? ` and give them the link [${name}](${href})` : ''}. A person can undo it from the Review queue's Decided tab.`;
    }
    return `${action_id} is DONE (run #${res.runId}, confidence ${confidence}) — it was reversible and above the bar, so it ran without waiting. Say it was done, and that a person can undo it from the Review queue's Decided tab. Result: ${JSON.stringify(res.result ?? {}).slice(0, 400)}`;
  } catch (err) {
    if (err instanceof ActionError) {
      return opts.refused ? opts.refused(err.code, err.message) : `Proposal refused (${err.code}): ${err.message}`;
    }
    return `Proposal failed: ${(err as Error).message}`;
  }
}

/**
 * The typed tool for a record type, when this agent has one: a candidate of
 * that type proposed here is steered to it.
 * @param ctx - The turn.
 * @param actionId - The proposed action.
 * @param input - Its input.
 */
function filingToolFor(ctx: RuntimeContext, actionId: string, input: Record<string, unknown>): string | undefined {
  if (actionId !== 'objects.propose_candidate' || typeof input?.objectType !== 'string') {
    return undefined;
  }
  return (ctx.filingTypes ?? []).find(t => t.slug === input.objectType && ctx.objectTypeSlugs.includes(t.slug))?.toolName;
}

export function proposeActionTool(ctx: RuntimeContext) {
  const available = listActions().map(a => `${a.id} — ${a.description}`).join('\n');
  const filing = (ctx.filingTypes ?? []).filter(t => ctx.objectTypeSlugs.includes(t.slug));
  const filingNote = filing.length > 0
    ? `\n\nTo FILE a record of a type with its own tool — ${filing.map(t => `${t.slug} → ${t.toolName}`).join(', ')} — call that tool, not objects.propose_candidate here: its arguments are the type's own fields, and nothing is left to guess.`
    : '';

  const proposeTool = tool(
    async (input) => {
      const { action_id, action_input, confidence, rationale, evidence, suggested_decision, suggested_decision_reason, suggested_snooze_until } = input as {
        action_id: string;
        action_input: Record<string, unknown>;
        confidence: number;
        rationale: string;
        evidence?: string[];
        suggested_decision: SuggestedDecision;
        suggested_decision_reason: string;
        suggested_snooze_until?: string;
      };
      // A model can satisfy a required string with spaces. The tool refuses
      // that rather than queueing a card whose reason renders as a blank quote
      // under the badge — and says what to send instead, since the answer is
      // one sentence the model already has in mind.
      const reason = parseSuggestedDecisionReason(suggested_decision_reason);
      if (reason === undefined) {
        return `Proposal refused: suggested_decision_reason is required. Send ONE short sentence for why you recommended "${suggested_decision}", in words a reviewer can check against the record.`;
      }
      const typed = filingToolFor(ctx, action_id, action_input);
      return runProposal(ctx, {
        actionId: action_id,
        input: action_input,
        confidence,
        rationale,
        evidence,
        suggestedDecision: suggested_decision,
        suggestedDecisionReason: reason,
        suggestedSnoozeUntil: suggested_snooze_until,
      }, {
        tool: 'propose_action',
        // A refused candidate of a type with its own tool says which: that
        // tool's schema is the type's, so the retry cannot guess wrong again.
        refused: (code, message) => `Proposal refused (${code}): ${message}${typed ? ` Call ${typed} instead — its arguments are this type's fields, with the required ones marked.` : ''}`,
      });
    },
    {
      name: 'propose_action',
      description: `Propose a connector-write action (CRM update, email send). Use when your analysis concludes a record should be created/updated or a message sent. Done for you by default: a REVERSIBLE, low-risk action (a HubSpot property update) executes at once when your confidence is 0.8 or higher, and a person can undo it in one click; anything else — an email send, a low-confidence call, a kind a person has held — lands in the review queue with your confidence + rationale for approval. Give an honest confidence: it decides whether this runs now or waits. A HAND-OFF action (git.merge, deploy.release, aws.mutate, credentials.write and the other factory ids — performed by a person after approval, never here) takes the structured hand-off input: title, headline (one sentence, ≤140 chars, what approving does), summary (why), steps [{say, run?, url?}] in order (the card renders each command with a copy button), cost {amount, currency: 'USD', period?: once|month|year} when it costs anything, target (the account or environment it touches — "AWS account acme-prod (123456789012)"), sources [{label, url}] the person can check, and externalRef {system, id, url?} for the record it acts on. recipe (one text block) is the fallback when you cannot write steps. Available actions:\n${available}${filingNote}`,
      schema: proposeActionArgsSchema,
    },
  );
  // The call the model meant (a JSON-string payload, the envelope folded into
  // it), repaired before the schema reads it; a call still unusable is
  // refused naming exactly what is missing (`proposeActionArgs.ts`).
  return withArgumentRepair(proposeTool, { normalizeArgs: normalizeProposeActionArgs, explainSchemaMiss: explainProposeActionMiss });
}
