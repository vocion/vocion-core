import { os } from '@orpc/server';
import { z } from 'zod';
import {
  describeOnlineEvaluation,
  setOnlineEvaluationEnabled,
  setOnlineEvaluationSampling,
  setUpOnlineEvaluation,
  syncOnlineConfig,
  tearDownOnlineEvaluation,
} from '@/services/evals/online';
import {
  getDataset,
  getRun,
  listDatasets,
  listRuns,
  runDataset,
} from '@/services/EvalService';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

export const list = os
  .handler(async () => {
    const { orgId } = await guardAuth();
    return listDatasets(orgId);
  });

export const get = os
  .input(z.object({ slug: z.string() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const ds = await getDataset(orgId, input.slug);
    if (!ds) {
      throw ApiError.notFound({ slug: input.slug });
    }
    return ds;
  });

export const run = os
  .input(z.object({ datasetSlug: z.string() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return runDataset({ orgId, datasetSlug: input.datasetSlug });
  });

export const runs = os
  .input(z.object({ datasetId: z.number().int().positive().optional() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return listRuns(orgId, input.datasetId);
  });

export const runDetail = os
  .input(z.object({ runId: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const detail = await getRun(orgId, input.runId);
    if (!detail) {
      throw ApiError.notFound({ runId: input.runId });
    }
    return detail;
  });

/**
 * Continuous scoring of live traffic, and the switches that decide its cost.
 *
 * Kept on the same surface as the rest of evals, but worth reading as a group:
 * every one of these changes something that bills on the customer's own AWS
 * account for as long as it is running. Nothing here happens on a schedule or
 * as a side effect of a run — a person turns it on, and a person turns it off.
 */
export const onlineStatus = os
  .handler(async () => {
    const { orgId } = await guardAuth();
    // Asks AWS rather than trusting the stored row: AWS owns the resource, and
    // telling someone they are not being charged when they are is the one
    // answer this must never give.
    await syncOnlineConfig(orgId);
    return describeOnlineEvaluation(orgId);
  });

export const onlineSetUp = os
  .input(z.object({
    evaluatorIds: z.array(z.string()).optional(),
    samplingPercentage: z.number().int().min(1).max(100).optional(),
    /** Start scoring straight away. Left out, the config exists but samples nothing. */
    enableImmediately: z.boolean().optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return setUpOnlineEvaluation({ orgId, ...input });
  });

export const onlineSetEnabled = os
  .input(z.object({ enabled: z.boolean() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const state = await setOnlineEvaluationEnabled(orgId, input.enabled);
    if (!state) {
      throw ApiError.notFound({ onlineEvaluation: 'not set up for this workspace' });
    }
    return state;
  });

export const onlineSetSampling = os
  .input(z.object({ samplingPercentage: z.number().int().min(1).max(100) }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const state = await setOnlineEvaluationSampling(orgId, input.samplingPercentage);
    if (!state) {
      throw ApiError.notFound({ onlineEvaluation: 'not set up for this workspace' });
    }
    return state;
  });

export const onlineTearDown = os
  .handler(async () => {
    const { orgId } = await guardAuth();
    // Deletes the configuration from the customer's account. Disabling is
    // almost always what someone means instead — it stops the bill and keeps
    // the history — so this stays a separate, explicit call.
    await tearDownOnlineEvaluation(orgId);
    return { removed: true };
  });
