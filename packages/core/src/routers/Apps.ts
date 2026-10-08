import { ORPCError, os } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { userSchema } from '@/models/Schema';
import { AppTemplateError, appTemplatesForProject, installAppTemplateForProject } from '@/services/apps/AppTemplateService';
import { appsForUser } from '@/services/AppService';
import { guardAuth, guardRole } from './AuthGuards';

/**
 * The app rail's data: the apps the signed-in person has in any workspace
 * they can open, and per app the workspaces that have it (each app's
 * workspace picker). See `services/AppService.ts`.
 */
export const forUser = os.handler(async () => {
  const { userId } = await guardAuth();
  return appsForUser(userId);
});

/**
 * The signed-in person as a template names them: accountable for what it
 * stands up.
 * @param userId - The session's user.
 */
async function personOf(userId: string): Promise<{ email: string; name: string }> {
  const [row] = await db.select({ email: userSchema.email, name: userSchema.name }).from(userSchema).where(eq(userSchema.id, userId)).limit(1);
  return { email: row?.email ?? '', name: row?.name ?? row?.email ?? '' };
}

const AppId = z.string().min(1).max(60).regex(/^[a-z][a-z0-9_-]*$/);

/**
 * An app's templates for the active workspace: what each stands up, whether
 * it is set up here already, and whether this host can write one.
 */
export const templates = os
  .input(z.object({ appId: AppId }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const view = await appTemplatesForProject(orgId!, input.appId, await personOf(userId));
    if (!view) {
      throw new ORPCError('NOT_FOUND', { message: `unknown app "${input.appId}"` });
    }
    return view;
  });

/**
 * Stand a template's function up in the active workspace: write its files
 * with the interview's answers, turn its plugins on, apply. The installing
 * admin is accountable for what it stands up. Refusals come back in words —
 * an unanswered question (with each question's problem), a workspace applied
 * from git (with the repo path), files that would not load (nothing changed).
 */
export const installTemplate = os
  .input(z.object({
    appId: AppId,
    template: z.string().min(1).max(60).regex(/^[a-z][a-z0-9_-]*$/),
    answers: z.record(z.string(), z.string().max(2000)).default({}),
  }))
  .handler(async ({ input }) => {
    const { orgId } = await guardRole('org:admin');
    const { userId } = await guardAuth();
    const installer = await personOf(userId);
    if (!installer.email) {
      throw new ORPCError('PRECONDITION_FAILED', { message: 'Your account has no email, so the template has nobody to name accountable.' });
    }
    try {
      return await installAppTemplateForProject({ orgId: orgId!, appId: input.appId, templateSlug: input.template, answers: input.answers, installer, appliedBy: `user:${userId}` });
    } catch (error) {
      if (error instanceof AppTemplateError) {
        const status = { unknown: 'NOT_FOUND', answers: 'BAD_REQUEST', blocked: 'PRECONDITION_FAILED', invalid: 'UNPROCESSABLE_CONTENT' }[error.code];
        throw new ORPCError(status, { message: error.message, data: { code: error.code, problems: error.problems ?? {} } });
      }
      console.error('apps: template install failed', { orgId, appId: input.appId, template: input.template, error: error instanceof Error ? error.message : String(error) });
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'The template could not be set up. Nothing the install wrote was half-applied; try again, and if it repeats, the workspace\'s apply log says why.' });
    }
  });
