import { os } from '@orpc/server';
import { z } from 'zod';
import { accountsForUser, listProjectsForUser, resolveProjectForUser } from '@/services/ProjectService';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/**
 * What the sidebar switcher shows: every workspace the person can open across
 * every account they belong to, those accounts (oldest membership first), and
 * `account`, the one this request runs in — the eyebrow under the workspace
 * name. `account` comes from the session's tenancy, which follows the picked
 * workspace (`libs/tenancy.ts`), so it is always the owner of the active one.
 */
export const list = os.handler(async () => {
  const { userId, accountId } = await guardAuth();
  const [projects, accounts] = await Promise.all([listProjectsForUser(userId), accountsForUser(userId)]);
  return { projects, accounts, account: accounts.find(a => a.id === accountId) ?? null };
});

export const setActive = os
  .input(z.object({ projectId: z.string().min(1) }))
  .handler(async ({ input }) => {
    const { userId } = await guardAuth();
    const proj = await resolveProjectForUser(userId, { id: input.projectId });
    if (!proj) {
      throw ApiError.notFound();
    }
    // Note: the cookie is NOT set here. oRPC's fetch response bypasses Next's
    // cookie-writing machinery so cookies().set() would be silently dropped.
    // The sidebar switcher navigates through `/w/<slug>/…`, whose route
    // handler sets `vocion_active_project` server-side (libs/activeProject.ts);
    // this procedure remains the validated, cookie-less way for an API client
    // to check a project is switchable.
    return { ok: true, projectId: proj.id, slug: proj.slug };
  });
