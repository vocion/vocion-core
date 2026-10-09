import { os } from '@orpc/server';
import { z } from 'zod';
import { orgsMode } from '@/services/OrgPolicy';
import { accountsForUser, listProjectsForUser, resolveProjectForUser } from '@/services/ProjectService';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/**
 * What the sidebar switcher shows: every workspace the person can open across
 * every Org they belong to, those Orgs (`accounts`, oldest membership first),
 * and `account`, the Org this request runs in. `account` comes from the
 * session's tenancy, which follows the picked workspace (`libs/tenancy.ts`),
 * so it is always the owner of the active one. `orgsMode` is the deployment's
 * Org mode (`services/OrgPolicy.ts`): a single-Org install shows no Org at
 * all.
 */
export const list = os.handler(async () => {
  const { userId, accountId } = await guardAuth();
  const [projects, accounts] = await Promise.all([listProjectsForUser(userId), accountsForUser(userId)]);
  return { projects, accounts, account: accounts.find(a => a.id === accountId) ?? null, orgsMode: orgsMode() };
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
