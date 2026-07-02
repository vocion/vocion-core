/**
 * propose_action — the agent's hands, safely.
 *
 * Lets an agent propose a registered connector-write action (hubspot.update,
 * gmail.send, …) with a PROPOSAL ENVELOPE: confidence (0–1), rationale, and
 * evidence (doc uris). The action rides the full authz gate: external writes
 * at working autonomy land as `pending` action_runs in the unified review
 * queue for human approval — the agent recommends; a person decides. Approved
 * proposals execute with vault credentials; decisions later feed the trust
 * ladder (recommended → automated).
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { listActions } from '@/libs/actions/registry';
import { ActionError, proposeAction } from '@/services/ActionService';

export function proposeActionTool(ctx: RuntimeContext) {
  const available = listActions().map(a => `${a.id} — ${a.description}`).join('\n');

  return tool(
    async (input) => {
      const { action_id, action_input, confidence, rationale, evidence } = input as {
        action_id: string;
        action_input: Record<string, unknown>;
        confidence: number;
        rationale: string;
        evidence?: string[];
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
          proposal: { confidence, rationale, evidence },
        });
        ctx.emit({
          type: 'tool_progress',
          tool: 'propose_action',
          meta: { runId: res.runId, status: res.status },
        } as never);
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
      }),
    },
  );
}
