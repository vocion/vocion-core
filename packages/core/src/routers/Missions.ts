import { os } from '@orpc/server';
import { z } from 'zod';
import {
  cancelMission,
  getMission,
  getMissionRun,
  listMissionRuns,
  listMissions,
  promoteMissionToWorkflow,
  resumeMission,
  startMission,
  submitMissionRunFeedback,
} from '@/services/MissionService';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/**
 * Mission routes — the open-ended team work mode. Each maps to a
 * MissionService function so the UI can poll run state freely.
 */

const TeamInput = z.object({ lead: z.string(), members: z.array(z.string()).default([]) });

export const list = os.handler(async () => {
  const { orgId } = await guardAuth();
  return listMissions(orgId);
});

export const get = os.input(z.object({ slug: z.string() })).handler(async ({ input }) => {
  const { orgId } = await guardAuth();
  const mission = await getMission(orgId, input.slug);
  if (!mission) {
    throw ApiError.notFound();
  }
  return mission;
});

export const start = os
  .input(z.object({
    brief: z.string().min(1),
    title: z.string().optional(),
    missionSlug: z.string().optional(),
    team: TeamInput.optional(),
    autonomyLevel: z.number().int().min(1).max(5).optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    return startMission({ orgId, invokedBy: userId, ...input });
  });

/** Run a check of a standing mission NOW — the same pass its automation fires. */
export const check = os
  .input(z.object({ slug: z.string().min(1) }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const { scheduledCheckBrief } = await import('@/services/MissionService');
    const template = await getMission(orgId, input.slug);
    if (!template) {
      throw ApiError.notFound();
    }
    const run = await startMission({
      orgId,
      missionSlug: input.slug,
      brief: scheduledCheckBrief(template),
      title: `Check: ${template.name}`,
      mode: 'check',
      invokedBy: userId ?? 'manual-check',
    });
    return { runId: run.id, status: run.status };
  });

export const listRuns = os
  .input(z.object({
    status: z.string().optional(),
    limit: z.number().int().positive().max(100).default(50),
  }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return listMissionRuns(orgId, { status: input.status, limit: input.limit });
  });

export const getRun = os.input(z.object({ id: z.number().int().positive() })).handler(async ({ input }) => {
  const { orgId } = await guardAuth();
  const run = await getMissionRun(input.id, orgId);
  if (!run) {
    throw ApiError.notFound();
  }
  return run;
});

export const resume = os.input(z.object({ id: z.number().int().positive() })).handler(async ({ input }) => {
  const { orgId } = await guardAuth();
  return resumeMission(input.id, orgId);
});

export const cancel = os
  .input(z.object({ id: z.number().int().positive(), reason: z.string().optional() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return cancelMission(input.id, orgId, input.reason);
  });

export const submitFeedback = os
  .input(z.object({ id: z.number().int().positive(), rating: z.enum(['up', 'down']), note: z.string().optional() }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    await submitMissionRunFeedback({ orgId, runId: input.id, rating: input.rating, note: input.note, by: userId });
    return { ok: true };
  });

export const promote = os.input(z.object({ id: z.number().int().positive() })).handler(async ({ input }) => {
  const { orgId } = await guardAuth();
  return promoteMissionToWorkflow(input.id, orgId);
});
