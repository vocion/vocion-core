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
      try {
        const res = await proposeAction({
          orgId: ctx.orgId,
          actionId: action_id,
          input: action_input,
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
            suggestedDecisionReason: parseSuggestedDecisionReason(suggested_decision_reason),
            suggestedSnoozeUntil: suggested_snooze_until,
          },
        });
        ctx.emit({
          type: 'tool_progress',
          tool: 'propose_action',
          meta: { runId: res.runId, status: res.status, outcome: res.outcome },
        } as never);
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
        return `${action_id} executed immediately (run #${res.runId}): ${JSON.stringify(res.result ?? {}).slice(0, 500)}`;
      } catch (err) {
        if (err instanceof ActionError) {
          return `Proposal refused (${err.code}): ${err.message}`;
        }
        return `Proposal failed: ${(err as Error).message}`;
      }
    },
    {
      name: 'propose_action',
      description: `Propose a connector-write action (CRM update, email send) for human approval. Use when your analysis concludes a record should be created/updated or a message sent. The proposal lands in the review queue with your confidence + rationale — a human approves before anything touches the outside world. Available actions:\n${available}`,
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
