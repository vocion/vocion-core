import { os } from '@orpc/server';
import { z } from 'zod';
import {
  addRule,
  checkDedup,
  getNamespace,
  listNamespaces,
  removeRule,
  updateRule,
} from '@/services/MemoryService';
import { guardAuth } from './AuthGuards';

export const listLearningSteps = os
  .handler(async () => {
    const { orgId } = await guardAuth();
    return listNamespaces(orgId);
  });

export const get = os
  .input(z.object({ step: z.string() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return getNamespace(orgId, input.step);
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
    return addRule({
      orgId,
      stepName: input.step,
      ruleText: input.rule,
      source: input.source,
      createdBy: userId,
    });
  });

export const update = os
  .input(z.object({ ruleKey: z.string().min(1), rule: z.string().min(1) }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return updateRule({ orgId, key: input.ruleKey, ruleText: input.rule });
  });

export const remove = os
  .input(z.object({ ruleKey: z.string().min(1) }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return removeRule({ orgId, key: input.ruleKey });
  });
