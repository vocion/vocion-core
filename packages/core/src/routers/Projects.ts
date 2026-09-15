import { os } from '@orpc/server';
import { z } from 'zod';
import { listProjectsForUser, resolveProjectForUser } from '@/services/ProjectService';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

export const list = os.handler(async () => {
  const { userId } = await guardAuth();
  return { projects: await listProjectsForUser(userId) };
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
