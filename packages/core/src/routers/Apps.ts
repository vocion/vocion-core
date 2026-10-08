import type { AppsInstallInput } from '@/libs/actions/apps-install';
import type { TemplateInstallReceipt } from '@/services/apps/AppTemplateService';
import { ORPCError, os } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { answerInterview, loadAppTemplate } from '@/libs/workspace/appTemplates';
import { userSchema } from '@/models/Schema';
import { AppTemplateError, appTemplatesForProject, checkedPlan, projectName } from '@/services/apps/AppTemplateService';
import { draftFunctionPlan, FunctionDraftError } from '@/services/apps/FunctionDraftService';
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

/** An install as the person sees it: what it did, and the run whose Undo puts it all back. */
export type InstallResponse = TemplateInstallReceipt & { runId: number };

/**
 * Run `apps.install` as the person's own action — their press is the
 * approval, so it runs at once, and its run carries the Undo that puts the
 * whole install back. Refusals come back in words with their code.
 * @param ctx - Who and where.
 * @param ctx.orgId - The workspace.
 * @param ctx.userId - The person.
 * @param input - The action's input.
 */
async function runInstall(ctx: { orgId: string; userId: string }, input: AppsInstallInput): Promise<InstallResponse> {
  const { ActionError, proposeAction } = await import('@/services/ActionService');
  try {
    const res = await proposeAction({
      orgId: ctx.orgId,
      actionId: 'apps.install',
      input: input as unknown as Record<string, unknown>,
      principal: { kind: 'user', id: ctx.userId, role: 'admin', scope: { orgId: ctx.orgId } },
      invokedBy: ctx.userId,
    });
    if (res.status !== 'done' || !res.result) {
      throw new ORPCError('UNPROCESSABLE_CONTENT', { message: res.error ?? 'It could not be set up, and nothing was half-applied.', data: { code: 'failed', problems: {} } });
    }
    const { undo: _undo, ...receipt } = res.result as unknown as TemplateInstallReceipt & { undo?: unknown };
    return { ...receipt, runId: res.runId };
  } catch (error) {
    if (error instanceof ORPCError) {
      throw error;
    }
    if (error instanceof ActionError) {
      throw new ORPCError('PRECONDITION_FAILED', { message: error.message, data: { code: 'blocked', problems: {} } });
    }
    console.error('apps: install failed', { orgId: ctx.orgId, appId: input.appId, error: error instanceof Error ? error.message : String(error) });
    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'It could not be set up. Nothing the install wrote was half-applied; try again, and if it repeats, the workspace\'s apply log says why.' });
  }
}

function asOrpc(error: unknown): never {
  if (error instanceof AppTemplateError || error instanceof FunctionDraftError) {
    const status = ({ unknown: 'NOT_FOUND', answers: 'BAD_REQUEST', blocked: 'PRECONDITION_FAILED', invalid: 'UNPROCESSABLE_CONTENT', budget: 'PAYMENT_REQUIRED', model: 'BAD_GATEWAY' } as const)[error.code];
    throw new ORPCError(status, { message: error.message, data: { code: error.code, problems: error.problems ?? {} } });
  }
  throw error;
}

/**
 * Stand a template's function up in the active workspace: write its files
 * with the interview's answers, turn its plugins on, apply — as the person's
 * own action, undoable as one unit. The installing admin is accountable for
 * what it stands up. An unanswered question comes back on the question.
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
      throw new ORPCError('PRECONDITION_FAILED', { message: 'Your profile has no email, so the template has nobody to name accountable.' });
    }
    // The interview is answered here first, so a missing answer comes back on its question.
    try {
      const template = loadAppTemplate(input.appId, input.template);
      const answered = answerInterview(template.manifest, input.answers, { installer, workspace: { name: await projectName(orgId!) } });
      if (!answered.ok) {
        throw new AppTemplateError('answers', template.manifest.interview.filter(q => answered.problems[q.key]).map(q => `"${q.question}" ${answered.problems[q.key]}`).join('; '), answered.problems);
      }
    } catch (error) {
      asOrpc(error instanceof AppTemplateError ? error : new AppTemplateError('unknown', error instanceof Error ? error.message : String(error)));
    }
    return runInstall({ orgId: orgId!, userId }, { appId: input.appId, template: input.template, answers: input.answers });
  });

/**
 * Describe your own: a model drafts a plan from the person's words and the
 * same short interview — typed, validated, charged to the workspace, refused
 * in words while its budget is spent. Creates nothing; the preview does.
 */
export const draftPlan = os
  .input(z.object({
    appId: AppId,
    description: z.string().max(4000),
    answers: z.record(z.string(), z.string().max(2000)).default({}),
  }))
  .handler(async ({ input }) => {
    const { orgId } = await guardRole('org:admin');
    const { userId } = await guardAuth();
    const installer = await personOf(userId);
    try {
      const { plan } = await draftFunctionPlan({ orgId: orgId!, appId: input.appId, description: input.description, answers: input.answers, installer, workspaceName: await projectName(orgId!) });
      return { plan };
    } catch (error) {
      return asOrpc(error);
    }
  });

/**
 * Create a previewed plan — as edited — as the person's own action, through
 * the same install a template uses, undoable as one unit.
 */
export const createFromPlan = os
  .input(z.object({ appId: AppId, plan: z.record(z.string(), z.unknown()) }))
  .handler(async ({ input }) => {
    const { orgId } = await guardRole('org:admin');
    const { userId } = await guardAuth();
    try {
      checkedPlan(input.appId, input.plan);
    } catch (error) {
      asOrpc(error);
    }
    return runInstall({ orgId: orgId!, userId }, { appId: input.appId, plan: input.plan, answers: {} });
  });
