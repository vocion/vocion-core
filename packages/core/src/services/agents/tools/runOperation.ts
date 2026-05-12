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
  return tool(
    async (args) => {
      const { slug, input } = args;
      if (slugs.length > 0 && !slugs.includes(slug)) {
        return `Operation "${slug}" is not in scope for this agent. Available: ${slugs.join(', ')}.`;
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
      }),
    },
  );
}
