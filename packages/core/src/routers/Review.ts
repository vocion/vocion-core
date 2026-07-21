import { os } from '@orpc/server';
import { z } from 'zod';
import { trackReviewDecision } from '@/services/adoption/attribution';
import { approveSkillRun, getSkillRun, listSkillRuns, rejectSkillRun, submitSkillRunFeedback } from '@/services/SkillService';
import {
  cancelWorkflow,
  getWorkflowRun,
  listWorkflowRuns,
  resumeWorkflow,
  submitWorkflowRunFeedback,
} from '@/services/WorkflowService';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/**
 * Review Queue routes — list + act on pending skill runs and paused
 * workflow runs. Minimal surface: each route maps 1:1 to a service
 * function so the UI can poll freely without custom aggregation here.
 */

const ListSkillRunsInput = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'auto']).optional(),
  skillSlug: z.string().optional(),
  limit: z.number().int().positive().max(100).default(50),
});

const ListWorkflowRunsInput = z.object({
  status: z.enum(['running', 'paused', 'completed', 'failed', 'cancelled']).optional(),
  workflowSlug: z.string().optional(),
  limit: z.number().int().positive().max(100).default(50),
});

const RunIdInput = z.object({ id: z.number().int().positive() });
const ResumeInput = z.object({
  id: z.number().int().positive(),
  /** Human-supplied text for a run paused on an `ask` step (`awaiting_input:<step>`). */
  input: z.string().optional(),
});
const RejectInput = z.object({ id: z.number().int().positive(), reason: z.string().optional() });
const CancelInput = z.object({ id: z.number().int().positive(), reason: z.string().optional() });
const ApproveInput = z.object({
  id: z.number().int().positive(),
  rating: z.enum(['up', 'down']).nullable().optional(),
  note: z.string().optional(),
});
const FeedbackInput = z.object({
  id: z.number().int().positive(),
  kind: z.enum(['skill', 'workflow']).default('skill'),
  rating: z.enum(['up', 'down']).nullable().optional(),
  note: z.string().optional(),
});

/** Pending action proposals (the sweep's CRM updates) with confidence envelopes. */
export const listPendingActionsRoute = os.handler(async () => {
  const { orgId } = await guardAuth();
  const { db } = await import('@/libs/DB');
  const { actionRunSchema } = await import('@/models/Schema');
  const { and, desc, eq } = await import('drizzle-orm');
  return db
    .select()
    .from(actionRunSchema)
    .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.status, 'pending')))
    .orderBy(desc(actionRunSchema.createdAt))
    .limit(50);
});

/** Recently auto-executed proposals (trust-ladder audit surface). */
export const listAutoExecutedRoute = os.handler(async () => {
  const { orgId } = await guardAuth();
  const { db } = await import('@/libs/DB');
  const { actionRunSchema } = await import('@/models/Schema');
  const { and, desc, eq, sql } = await import('drizzle-orm');
  return db
    .select()
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      sql`${actionRunSchema.proposal} ->> 'autoApproved' = 'true'`,
    ))
    .orderBy(desc(actionRunSchema.createdAt))
    .limit(20);
});

/**
 * JIT-create a review item from an A2UI recommended-action card (user tapped
 * "prepare for review" on an agent recommendation). Reuses the AGENT's
 * authority — same principal shape as propose_action — so the write rides the
 * normal gate and lands `pending` for approval (never auto-fires; gmail.send is
 * guarded regardless). Returns the new run id so the UI can link to review.
 */
export const proposeFromRecommendationRoute = os
  .input(z.object({
    actionId: z.string(),
    input: z.record(z.string(), z.unknown()),
    agentSlug: z.string().optional(),
    rationale: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const { proposeAction } = await import('@/services/ActionService');
    const agentId = input.agentSlug ? `agent:${input.agentSlug}` : 'agent:unknown';
    const res = await proposeAction({
      orgId,
      actionId: input.actionId,
      input: input.input,
      principal: { kind: 'agent', id: agentId, scope: { orgId }, grants: ['*'], autonomy: 2 },
      invokedBy: userId ?? agentId,
      proposal: { confidence: input.confidence, rationale: input.rationale },
    });
    return res;
  });

/** Approve or reject a pending action proposal. */
export const decideActionRoute = os
  .input(z.object({
    id: z.number().int().positive(),
    decision: z.enum(['approve', 'reject']),
    reason: z.string().optional(),
    /** Operator-edited payload (edit-then-approve) — only applied on approve. */
    editedInput: z.record(z.string(), z.unknown()).optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const { decide } = await import('@/services/ReviewService');
    await decide({ kind: 'action', id: input.id }, input.decision, orgId, {
      reason: input.reason,
      reviewedBy: userId,
      editedInput: input.decision === 'approve' ? input.editedInput : undefined,
    });
    return { ok: true };
  });

export const listPendingSkillRuns = os
  .input(ListSkillRunsInput)
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return listSkillRuns({
      orgId,
      status: input.status,
      skillSlug: input.skillSlug,
      limit: input.limit,
    });
  });

export const getRun = os
  .input(RunIdInput)
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const run = await getSkillRun(orgId, input.id);
    if (!run) {
      throw ApiError.notFound();
    }
    return run;
  });

export const approve = os
  .input(ApproveInput)
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const feedback = input.rating !== undefined || input.note !== undefined
      ? { rating: input.rating, note: input.note }
      : undefined;
    const run = await approveSkillRun({ orgId, runId: input.id, reviewedBy: userId, feedback });
    if (!run) {
      throw ApiError.notFound();
    }
    return run;
  });

export const reject = os
  .input(RejectInput)
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const run = await rejectSkillRun({ orgId, runId: input.id, reviewedBy: userId, feedback: input.reason ? { note: input.reason, rating: 'down' } : undefined });
    if (!run) {
      throw ApiError.notFound();
    }
    return run;
  });

export const submitFeedback = os
  .input(FeedbackInput)
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const submit = input.kind === 'workflow' ? submitWorkflowRunFeedback : submitSkillRunFeedback;
    const run = await submit({
      orgId,
      runId: input.id,
      submittedBy: userId,
      rating: input.rating,
      note: input.note,
    });
    if (!run) {
      throw ApiError.notFound();
    }
    return run;
  });

export const listWorkflowRunsRoute = os
  .input(ListWorkflowRunsInput)
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return listWorkflowRuns(orgId, {
      status: input.status,
      workflowSlug: input.workflowSlug,
      limit: input.limit,
    });
  });

export const getWorkflowRunRoute = os
  .input(RunIdInput)
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const run = await getWorkflowRun(input.id, orgId);
    if (!run) {
      throw ApiError.notFound();
    }
    return run;
  });

export const resume = os
  .input(ResumeInput)
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const run = await resumeWorkflow(input.id, orgId, input.input !== undefined ? { input: input.input } : undefined);
    void trackReviewDecision({ orgId, userId }, { kind: 'workflow', id: input.id }, 'approved');
    return run;
  });

export const cancel = os
  .input(CancelInput)
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const run = await cancelWorkflow(input.id, orgId, input.reason);
    void trackReviewDecision({ orgId, userId }, { kind: 'workflow', id: input.id }, 'rejected');
    return run;
  });
