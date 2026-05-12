/**
 * request_human_review — universal HITL gate primitive (Phase 8).
 *
 * The agent emits a structured `hitl_gate` event the UI renders as an
 * approve/reject panel. After the user responds, the parent client
 * sends a follow-up turn carrying the approval token in plain text;
 * the agent reads its own prior text reply (which contained the gate
 * request) and the new user turn together — no checkpointer needed.
 *
 * This generalizes rev-ai's blueprint-review page (server/hitl.py).
 * The same primitive backs workflow-run approve steps and any other
 * artifact that wants a "hold for human eyes" pause.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export function requestHumanReviewTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      ctx.emit({
        type: 'hitl_gate',
        gate: {
          name: args.name,
          question: args.question,
          payload: args.payload,
          resumeUrl: args.resumeUrl,
        },
      });
      // Tool return surfaces in the model's tool message; phrase it so
      // the model understands the run is paused waiting on the user.
      return `[HITL gate emitted: ${args.name}. Wait for the user's approval in the next turn before proceeding. If they say "approve" / "yes" / "go ahead", continue. If they say "reject" / "no" / "stop", abandon the planned action.]`;
    },
    {
      name: 'request_human_review',
      description: 'Pause for human approval before taking a non-trivial action (sending an email, finalizing a deck, applying a workflow step). The UI renders an approve/reject panel; the user\'s next turn carries their decision. Use this BEFORE high-stakes side effects, not after.',
      schema: z.object({
        name: z.string().regex(/^[a-z][a-z0-9_-]*$/).describe('short slug identifying the gate (e.g. "send-followup-email", "publish-deck")'),
        question: z.string()
          .describe('one-line question shown to the user, e.g. "Send this follow-up email to ACME?"'),
        payload: z.record(z.string(), z.unknown()).optional().describe('arbitrary object the UI renders (draft text, deck preview, diff)'),
        resumeUrl: z.string().optional().describe('optional deep link the user can open to review more detail'),
      }),
    },
  );
}
