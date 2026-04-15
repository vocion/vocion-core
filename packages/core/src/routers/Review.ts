import { os } from '@orpc/server';
import { z } from 'zod';
import { approveSkillRun, getSkillRun, listSkillRuns, rejectSkillRun, submitSkillRunFeedback } from '@/services/SkillService';
import {
  cancelWorkflow,
  getWorkflowRun,
  listWorkflowRuns,
  resumeWorkflow,
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
const RejectInput = z.object({ id: z.number().int().positive(), reason: z.string().optional() });
const CancelInput = z.object({ id: z.number().int().positive(), reason: z.string().optional() });
const ApproveInput = z.object({
  id: z.number().int().positive(),
  rating: z.enum(['up', 'down']).nullable().optional(),
  note: z.string().optional(),
});
const FeedbackInput = z.object({
  id: z.number().int().positive(),
  rating: z.enum(['up', 'down']).nullable().optional(),
  note: z.string().optional(),
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
    const { orgId } = await guardAuth();
    const feedback = input.rating !== undefined || input.note !== undefined
      ? { rating: input.rating, note: input.note }
      : undefined;
    const run = await approveSkillRun({ orgId, runId: input.id, reviewedBy: 'web', feedback });
    if (!run) {
      throw ApiError.notFound();
    }
    return run;
  });

export const reject = os
  .input(RejectInput)
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const run = await rejectSkillRun({ orgId, runId: input.id, reviewedBy: 'web', feedback: input.reason ? { note: input.reason, rating: 'down' } : undefined });
    if (!run) {
      throw ApiError.notFound();
    }
    return run;
  });

export const submitFeedback = os
  .input(FeedbackInput)
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const run = await submitSkillRunFeedback({
      orgId,
      runId: input.id,
      submittedBy: 'web',
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
  .input(RunIdInput)
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return resumeWorkflow(input.id, orgId);
  });

export const cancel = os
  .input(CancelInput)
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return cancelWorkflow(input.id, orgId, input.reason);
  });
