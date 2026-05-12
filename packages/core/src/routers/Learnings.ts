import { os } from '@orpc/server';
import { z } from 'zod';
import {
  addLearning,
  checkDedup,
  getLearnings,
  listSteps,
  removeLearning,
  updateLearning,
} from '@/services/LearningsService';
import { guardAuth } from './AuthGuards';

export const listLearningSteps = os
  .handler(async () => {
    const { orgId } = await guardAuth();
    return listSteps(orgId);
  });

export const get = os
  .input(z.object({ step: z.string() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return getLearnings(orgId, input.step);
  });

export const check = os
  .input(z.object({ step: z.string(), rule: z.string() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return checkDedup(orgId, input.step, input.rule);
  });

export const add = os
  .input(z.object({
    step: z.string(),
    rule: z.string().min(1),
    source: z.string().optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    return addLearning({
      orgId,
      stepName: input.step,
      ruleText: input.rule,
      source: input.source,
      createdBy: userId,
    });
  });

export const update = os
  .input(z.object({ ruleId: z.number().int().positive(), rule: z.string().min(1) }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return updateLearning({ orgId, ruleId: input.ruleId, ruleText: input.rule });
  });

export const remove = os
  .input(z.object({ ruleId: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return removeLearning({ orgId, ruleId: input.ruleId });
  });
