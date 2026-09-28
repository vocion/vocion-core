import { ORPCError, os } from '@orpc/server';
import { z } from 'zod';
import { readRunLog } from '@/services/runs/RunLogService';
import { guardAuth } from './AuthGuards';

/**
 * runs.log — what a run page polls while the run is live (backlog 036).
 *
 * `ref` is the page's path id (`123` an engineering run, `agent-45` an agent
 * run); `after` the last seq or tool call id the page holds. The reply carries
 * the run's header and plan whole (small, changed in place) and only the lines
 * after `after`, so a poll every few seconds costs one indexed read of what is
 * new. Org-scoped: another workspace's run is NOT_FOUND.
 */
export const logRoute = os
  .input(z.object({
    ref: z.string().regex(/^(?:agent-)?\d{1,12}$/),
    after: z.number().int().min(0).default(0),
  }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const data = await readRunLog(orgId, input.ref, input.after);
    if (!data) {
      throw new ORPCError('NOT_FOUND', { message: `No run ${input.ref} in this workspace` });
    }
    return data;
  });
