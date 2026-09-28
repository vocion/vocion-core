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
import { proposeActionArgsSchema } from '@/libs/actions/proposeActionArgs';
import { listActions } from '@/libs/actions/registry';
import { parseSuggestedDecisionReason } from '@/libs/actions/suggestedDecision';
import { ActionError, proposeAction } from '@/services/ActionService';
import { deriveRecommendationDedupKey } from '@/services/chat/autoPropose';
import { checkProposalBudget, isAgentsOwnSchedule } from '@/services/proposals/ProposalBudgetService';
import { emitSelfUpdate } from '../selfUpdateEvent';

export function proposeActionTool(ctx: RuntimeContext) {
  const available = listActions().map(a => `${a.id} — ${a.description}`).join('\n');

  return tool(
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
      // THE PROPOSAL BUDGET. An agent on its own schedule may hold only so
      // many undecided items in Review; past that it withdraws one of its
      // own before it files another. A person's own turn is never counted.
      if (ctx.agentSlug && isAgentsOwnSchedule(ctx)) {
        const verdict = await checkProposalBudget({ orgId: ctx.orgId, agentSlug: ctx.agentSlug, actionId: action_id });
        if (!verdict.ok) {
          return verdict.message;
        }
      }
      try {
        const res = await proposeAction({
          orgId: ctx.orgId,
          actionId: action_id,
          input: action_input,
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
          invokedBy: ctx.agentSlug ? `agent:${ctx.agentSlug}` : ctx.userId,
          proposal: {
            confidence,
            rationale,
            evidence,
            suggestedDecision: suggested_decision,
            suggestedDecisionReason: reason,
            suggestedSnoozeUntil: suggested_snooze_until,
          },
        });
        ctx.emit({
          type: 'tool_progress',
          tool: 'propose_action',
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
        return `${action_id} is DONE (run #${res.runId}, confidence ${confidence}) — it was reversible and above the bar, so it ran without waiting. Say it was done, and that a person can undo it from the Review queue's Decided tab. Result: ${JSON.stringify(res.result ?? {}).slice(0, 400)}`;
      } catch (err) {
        if (err instanceof ActionError) {
          return `Proposal refused (${err.code}): ${err.message}`;
        }
        return `Proposal failed: ${(err as Error).message}`;
      }
    },
    {
      name: 'propose_action',
      description: `Propose a connector-write action (CRM update, email send). Use when your analysis concludes a record should be created/updated or a message sent. Done for you by default: a REVERSIBLE, low-risk action (a HubSpot property update) executes at once when your confidence is 0.8 or higher, and a person can undo it in one click; anything else — an email send, a low-confidence call, a kind a person has held — lands in the review queue with your confidence + rationale for approval. Give an honest confidence: it decides whether this runs now or waits. A HAND-OFF action (git.merge, deploy.release, aws.mutate, credentials.write and the other factory ids — performed by a person after approval, never here) takes the structured hand-off input: title, headline (one sentence, ≤140 chars, what approving does), summary (why), steps [{say, run?, url?}] in order (the card renders each command with a copy button), cost {amount, currency: 'USD', period?: once|month|year} when it costs anything, target (the account or environment it touches — "AWS account acme-prod (123456789012)"), sources [{label, url}] the person can check, and externalRef {system, id, url?} for the record it acts on. recipe (one text block) is the fallback when you cannot write steps. Available actions:\n${available}`,
      schema: proposeActionArgsSchema,
    },
  );
}
