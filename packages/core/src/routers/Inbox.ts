import { os } from '@orpc/server';
import { z } from 'zod';
import { listInboxForUser, needsYouCountForUser } from '@/services/inbox/acrossWorkspaces';
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
