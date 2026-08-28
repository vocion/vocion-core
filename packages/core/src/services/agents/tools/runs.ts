/**
 * Agent tools for surveying past runs + their feedback.
 *
 * Used by the self-improver subagent to surface recurring user
 * corrections. Read-only — these tools never mutate. Operation runs
 * are gone with the operations layer; the run record here is workflow
 * runs (which carry ratings + notes) and action runs (review signals).
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { actionRunSchema, workflowRunSchema, workflowSchema } from '@/models/Schema';

export function listRecentRunsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const [workflowRows, actionRows] = await Promise.all([
        db
          .select({
            id: workflowRunSchema.id,
            status: workflowRunSchema.status,
            rating: workflowRunSchema.rating,
            feedbackNote: workflowRunSchema.feedbackNote,
            createdAt: workflowRunSchema.createdAt,
            workflowSlug: workflowSchema.slug,
          })
          .from(workflowRunSchema)
          .leftJoin(workflowSchema, eq(workflowSchema.id, workflowRunSchema.workflowId))
          .where(eq(workflowRunSchema.orgId, ctx.orgId))
          .orderBy(desc(workflowRunSchema.createdAt))
          .limit(args.limit ?? 25),
        db
          .select({
            id: actionRunSchema.id,
            actionId: actionRunSchema.actionId,
            status: actionRunSchema.status,
            createdAt: actionRunSchema.createdAt,
          })
          .from(actionRunSchema)
          .where(eq(actionRunSchema.orgId, ctx.orgId))
          .orderBy(desc(actionRunSchema.createdAt))
          .limit(args.limit ?? 25),
      ]);
      const workflow = args.withFeedbackOnly
        ? workflowRows.filter(r => r.rating || (r.feedbackNote && r.feedbackNote.trim().length > 0))
        : workflowRows;
      return JSON.stringify({
        count: workflow.length + actionRows.length,
        workflowRuns: workflow.map(r => ({ kind: 'workflow', ...r })),
        actionRuns: args.withFeedbackOnly ? [] : actionRows.map(r => ({ kind: 'action', ...r })),
      }, null, 2);
    },
    {
      name: 'list_recent_runs',
      description: 'List recent workflow runs and action proposals in this org. Use to find candidate items the self-improver subagent should look at. Set `withFeedbackOnly` to only see workflow runs carrying a rating/note.',
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
        .from(workflowRunSchema)
        .where(and(eq(workflowRunSchema.orgId, ctx.orgId), eq(workflowRunSchema.id, args.runId)));
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
        stepResults: row.stepResults,
        workspaceSha: row.workspaceSha,
      }, null, 2);
    },
    {
      name: 'list_run_feedback',
      description: 'Return the feedback signal (rating + note + step results) for a single workflow run id. Use after list_recent_runs to study a specific case.',
      schema: z.object({ runId: z.number().int().positive() }),
    },
  );
}
