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
import { z } from 'zod';
import { listActions } from '@/libs/actions/registry';
import { parseSuggestedDecisionReason, SUGGESTED_DECISIONS } from '@/libs/actions/suggestedDecision';
import { ActionError, proposeAction } from '@/services/ActionService';
import { deriveRecommendationDedupKey } from '@/services/chat/autoPropose';
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
      schema: z.object({
        action_id: z.string().describe('Registered action id, e.g. "hubspot.update" or "gmail.send"'),
        action_input: z.record(z.string(), z.unknown()).describe('The action\'s input payload (e.g. for hubspot.update: { objectType: "deals", objectId: "123", properties: { dealstage: "..." } })'),
        confidence: z.number().min(0).max(1).describe('Your confidence this change is correct, 0–1 (e.g. 0.85)'),
        rationale: z.string().describe('One or two sentences: WHY this change, citing the evidence'),
        evidence: z.array(z.string()).optional().describe('Source doc uris/ids backing the proposal (e.g. gmail message ids, hubspot record uris)'),
        suggested_decision: z.enum(SUGGESTED_DECISIONS).describe('Required on every proposal. What you think the reviewer should DO, which is a different question from how confident you are: "approve" to go ahead, "reject" if you believe this should be turned down, "snooze" if it is worth another look later. Always pick the one that best fits the criteria you were given — an unsure read is still a read, and "I would lean to approving this" is worth more to a reviewer than silence. Say "reject" when that is genuinely your call: filing a record you think should be declined is how a person sees your judgement. Advisory: a person always decides, and this never makes anything run on its own.'),
        suggested_decision_reason: z.string().describe('Required on every proposal. ONE short sentence for why you recommended that, in plain words a reviewer can check: "third listing of this same show this week", "date has already passed", "venue is outside the coverage area". Keep it to roughly that length — it is read beside a badge on a card, so one clause beats two, and a paragraph is wrong however true it is. This is not the same as `rationale` — that one argues your payload is right, this one argues what should happen to it, which is the whole content of a "reject". Name the one thing that tipped it, do not restate the payload, and do not say how confident you feel.'),
        suggested_snooze_until: z.string().optional().describe('ISO timestamp for when this is worth revisiting. Only meaningful with suggested_decision "snooze".'),
      }),
    },
  );
}
