/**
 * request_human_review — hold for a person's yes before a high-stakes step.
 *
 * It is a Decision like any other (`libs/decisions/decision.ts`): in a
 * person's own conversation in the app the gate becomes an approval docked
 * above their composer — the chat route's escalation seam turns the
 * `hitl_gate` event into it (`services/decisions/escalate.ts`) — and raising it
 * ENDS the turn (`agents/handOff.ts`); their answer comes back as a typed
 * decision event, never as the words "approve" or "reject" in their mouth.
 * With nobody here (a mission, an automation) it is filed on Needs you as a
 * `gate` ask, with its deadline and default, through `file_ask`'s own path.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { personIsHere } from '../decisionHolder';

export function requestHumanReviewTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      if (personIsHere(ctx) && ctx.conversationId) {
        ctx.emit({
          type: 'hitl_gate',
          gate: {
            name: args.name,
            question: args.question,
            payload: args.payload,
            resumeUrl: args.resumeUrl,
          },
        });
        return `Asked them to approve "${args.question}" — docked above their composer. Your turn ends here; their answer comes back to you as a typed decision event. Do not go ahead before it does, and do not ask again in words.`;
      }
      // Nobody is here to ask: it waits on Needs you with a deadline and a default.
      const { fileAskTool } = await import('./fileAsk');
      return fileAskTool(ctx).invoke({
        title: args.question,
        kind: 'gate',
        ...(args.resumeUrl?.startsWith('https://') ? { context_url: args.resumeUrl } : {}),
        ...(args.payload ? { context_md: (await import('@/services/decisions/preview')).payloadPreview(args.payload) ?? undefined } : {}),
        options: [{ id: 'approve', label: 'Allow once', description: 'It goes ahead, this once.', recommended: true }, { id: 'reject', label: 'Deny', description: 'It does not happen; the agent hears no.' }],
        confidence: 0.9,
      }) as Promise<string>;
    },
    {
      name: 'request_human_review',
      description: 'Hold for a person\'s approval before a non-trivial action (sending an email, finalizing a deck, applying a workflow step): it is put in front of them as an approval — docked above their composer in their own conversation, on Needs you otherwise — and your turn ends there. Their answer comes back to you as a typed decision event. Use this BEFORE high-stakes side effects, not after.',
      schema: z.object({
        name: z.string().regex(/^[a-z][a-z0-9_-]*$/).describe('short slug identifying the gate (e.g. "send-followup-email", "publish-deck")'),
        question: z.string()
          .describe('one-line question shown to the user, e.g. "Send this follow-up email to ACME?"'),
        payload: z.record(z.string(), z.unknown()).optional().describe('arbitrary object the person can open to review (draft text, deck preview, diff)'),
        resumeUrl: z.string().optional().describe('optional deep link the person can open to review more detail'),
      }),
    },
  );
}
