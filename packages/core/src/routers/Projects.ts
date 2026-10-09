import { os } from '@orpc/server';
import { z } from 'zod';
import { orgsMode } from '@/services/OrgPolicy';
import { accountsForUser, listProjectsForUser, resolveProjectForUser } from '@/services/ProjectService';
import { createSharedWorkspace, WorkspaceNameError } from '@/services/workspace/createWorkspace';
import { workspaceOverviewForUser } from '@/services/workspace/overview';
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

/**
 * projects.overview — the All workspaces page: every workspace the person can
 * open (archived ones flagged), who leads each, how many agents, when it was
 * last used, the Orgs, and each Org's mark (`services/workspace/overview.ts`).
 * What waits on the person comes from `inbox.mineCount`, the one count.
 */
export const overview = os.handler(async () => {
  const { userId, accountId, projectId } = await guardAuth();
  const data = await workspaceOverviewForUser(userId);
  return { ...data, account: data.accounts.find(a => a.id === accountId) ?? null, activeId: projectId, orgsMode: orgsMode() };
});

/**
 * projects.create — a new shared workspace in the Org this request runs in,
 * made by an Org admin, held by them, opening on its lead. Returns its slug so
 * the page can open it.
 */
export const create = os
  .input(z.object({ name: z.string().min(1).max(200) }))
  .handler(async ({ input }) => {
    const { userId, accountId, role } = await guardAuth();
    if (role !== 'admin' || !accountId) {
      throw ApiError.forbidden({ message: 'Only an Org admin can create a workspace.' });
    }
    try {
      return await createSharedWorkspace({ userId, accountId, name: input.name });
    } catch (error) {
      if (error instanceof WorkspaceNameError) {
        throw ApiError.badRequest(error.message);
      }
      throw error;
    }
  });
