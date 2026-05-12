/**
 * Agent tools for surveying past operation runs + their feedback.
 *
 * Used by the self-improver subagent to surface recurring user
 * corrections. Read-only — these tools never mutate.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { skillRunSchema, skillSchema } from '@/models/Schema';

export function listRecentRunsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const rows = await db
        .select({
          id: skillRunSchema.id,
          status: skillRunSchema.status,
          rating: skillRunSchema.rating,
          feedbackNote: skillRunSchema.feedbackNote,
          createdAt: skillRunSchema.createdAt,
          skillName: skillSchema.name,
          skillSlug: skillSchema.slug,
        })
        .from(skillRunSchema)
        .leftJoin(skillSchema, eq(skillSchema.id, skillRunSchema.skillId))
        .where(eq(skillRunSchema.orgId, ctx.orgId))
        .orderBy(desc(skillRunSchema.createdAt))
        .limit(args.limit ?? 25);
      const filtered = args.withFeedbackOnly
        ? rows.filter(r => r.rating || (r.feedbackNote && r.feedbackNote.trim().length > 0))
        : rows;
      return JSON.stringify(filtered, null, 2);
    },
    {
      name: 'list_recent_runs',
      description: 'List recent operation runs in this org. Use to find candidate items the self-improver subagent should look at. Set `withFeedbackOnly` to skip runs that have no rating/note.',
      schema: z.object({
        limit: z.number().int().positive().max(100).optional(),
        withFeedbackOnly: z.boolean().optional(),
      }),
    },
  );
}

export function listRunFeedbackTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const [row] = await db
        .select()
        .from(skillRunSchema)
        .where(and(eq(skillRunSchema.orgId, ctx.orgId), eq(skillRunSchema.id, args.runId)));
      if (!row) {
        return JSON.stringify({ error: 'not_found' });
      }
      return JSON.stringify({
        runId: row.id,
        status: row.status,
        rating: row.rating,
        feedbackNote: row.feedbackNote,
        feedbackBy: row.feedbackBy,
        feedbackAt: row.feedbackAt,
        input: row.input,
        outputPreview: row.output ? row.output.slice(0, 1200) : null,
        contextSha: row.contextSha,
      }, null, 2);
    },
    {
      name: 'list_run_feedback',
      description: 'Return the feedback signal (rating + note + input + output preview) for a single operation run id. Use after list_recent_runs to study a specific case.',
      schema: z.object({ runId: z.number().int().positive() }),
    },
  );
}
