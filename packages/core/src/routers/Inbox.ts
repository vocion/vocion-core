import { os } from '@orpc/server';
import { z } from 'zod';
import { listInboxForUser, needsYouCountForUser } from '@/services/inbox/acrossWorkspaces';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/**
 * inbox.mine — everything waiting on the signed-in person across every
 * workspace they reach (their own included), their own rows first, each
 * tagged with its workspace and linked to it there
 * (`services/inbox/acrossWorkspaces.ts`). `workspaceId` narrows the rows to
 * one workspace; the per-workspace counts always cover them all.
 */
export const mineRoute = os
  .input(z.object({ workspaceId: z.string().min(1).max(200).optional() }).default({}))
  .handler(async ({ input }) => {
    const { userId } = await guardAuth();
    return listInboxForUser(userId, input.workspaceId ? { workspaceId: input.workspaceId } : {});
  });

/**
 * inbox.mineCount — the cross-workspace badge: decisions waiting, how many are
 * the person's own, and where. Counted by the same admission bar as the list.
 */
export const mineCountRoute = os.handler(async () => {
  const { userId } = await guardAuth();
  return needsYouCountForUser(userId);
});

/**
 * inbox.acceptBatch — accept every decision in a batch as recommended, as the
 * signed-in person, in the workspace the request runs in
 * (`services/needsYou/batches.ts`). `refs` are the items the person saw under
 * the batch; anything decided or changed since is skipped and said so, and
 * one failure never stops the rest. Returns the outcome of each.
 */
export const acceptBatchRoute = os
  .input(z.object({
    key: z.string().min(1).max(200),
    refs: z.array(z.string().min(1).max(40)).min(1).max(100),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const { acceptBatch, BatchError } = await import('@/services/needsYou/batches');
    try {
      return await acceptBatch({ orgId, userId, key: input.key, refs: input.refs });
    } catch (err) {
      if (err instanceof BatchError) {
        throw ApiError.badRequest(err.message);
      }
      throw err;
    }
  });

/**
 * inbox.undoDefault — take back an answer that applied by default at its
 * deadline: the question is open again, and its default never applies a
 * second time (`DecisionClockService.undoAskDefault`). A person's own answer
 * is never unwritten here.
 */
export const undoDefaultRoute = os
  .input(z.object({ askId: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const { DefaultUndoError, undoAskDefault } = await import('@/services/needsYou/DecisionClockService');
    try {
      const ask = await undoAskDefault({ orgId, askId: input.askId, by: userId });
      return { ok: true, status: ask.status };
    } catch (err) {
      if (err instanceof DefaultUndoError) {
        throw err.status === 404 ? ApiError.notFound({ message: err.message }) : ApiError.badRequest(err.message);
      }
      throw err;
    }
  });
