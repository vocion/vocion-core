import { os } from '@orpc/server';
import { z } from 'zod';
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
