import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { executeSkill } from '@/services/OperationService';

/**
 * run_operation — invoke a typed operation (formerly "skill").
 *
 * One generic tool, not one tool per operation, so adding an operation
 * doesn't bloat the tool catalog sent to the model on every turn. The
 * `slug` parameter is constrained to the agent's `operationSlugs` list
 * so the LLM can't reach operations outside its scope.
 *
 * Operations that emit structured frontend cards (proposal,
 * email-draft) should set `result.emitCard` server-side — handled here
 * so the legacy `skill_result` event shape keeps working.
 * @param ctx
 */
export function runOperationTool(ctx: RuntimeContext) {
  const slugs = ctx.operationSlugs;
  const interrupts = ctx.harnessConfig.interrupts ?? [];
  return tool(
    async (args) => {
      const { slug, input } = args;
      if (slugs.length > 0 && !slugs.includes(slug)) {
        return `Operation "${slug}" is not in scope for this agent. Available: ${slugs.join(', ')}.`;
      }

      // Harness interrupt gate: operations listed in the agent's
      // `harness.interrupts` pause for human approval BEFORE executing.
      // Same conversational HITL contract as request_human_review: the
      // gate renders in the UI, the user's next turn carries the
      // decision, and the model re-calls with `approved: true`.
      if (interrupts.includes(slug) && !args.approved) {
        ctx.emit({
          type: 'hitl_gate',
          gate: {
            name: `run-${slug.replace(/_/g, '-')}`,
            question: `Run the "${slug}" operation with these inputs?`,
            payload: { operation: slug, input },
          },
        });
        return `[Operation "${slug}" is interrupt-gated: it was NOT executed. An approval gate was shown to the user. Stop and wait for their decision in the next turn. If they approve, call run_operation again with approved: true; if they reject, abandon it.]`;
      }

      const result = await executeSkill({
        orgId: ctx.orgId,
        skillSlug: slug,
        input: input as Record<string, unknown>,
        userId: ctx.userId,
      });

      // Surface a structured card to the chat UI when the operation
      // produced a renderable artifact (drafts, proposals).
      const status: 'pending' | 'auto'
        = result.skill.requiresApproval === 'true' ? 'pending' : 'auto';
      if (slug === 'draft_followup_email' || slug === 'draft_mvp_proposal') {
        ctx.emit({
          type: 'skill_result',
          skillResult: {
            skillName: result.skill.name,
            skillSlug: result.skill.slug,
            runId: result.runId,
            content: result.output,
            status,
            prospectName: (input as { prospect_name?: string } | undefined)?.prospect_name,
            prospectCompany: (input as { prospect_company?: string } | undefined)?.prospect_company,
          },
        });
        // Don't echo full output back to the model — it would re-spew
        // the email/proposal in its reply. The card is the surface.
        return `[Operation "${result.skill.name}" produced a draft for the user (run #${result.runId}, status=${status}). Do NOT repeat the content. Acknowledge the draft was created and offer to revise.]`;
      }
      return `[Operation: ${result.skill.name} | Run #${result.runId}]\n\n${result.output}`;
    },
    {
      name: 'run_operation',
      description: `Invoke a typed operation (a single LLM call + plugin code). ${slugs.length > 0 ? `Available slugs: ${slugs.join(', ')}.` : 'No operations are in scope for this agent.'} Use for tasks the operation was designed for; do not use it as a generic LLM passthrough.`,
      schema: z.object({
        slug: z.string().describe('operation slug to invoke'),
        input: z.record(z.string(), z.unknown()).describe('arguments matching the operation\'s declared inputSchema'),
        approved: z.boolean().optional().describe('for interrupt-gated operations ONLY: set true after — and only after — the user has explicitly approved this exact operation in a later turn'),
      }),
    },
  );
}
