/**
 * apps.install — stand a function up in a workspace, from an app's template
 * or from a plan a model drafted and a person edited.
 *
 * One action for both, over one install path (`services/apps/AppTemplateService.ts`
 * `installRendered`), so a template and a blank start produce the same kind
 * of records: workspace files (teams, agents, missions, automations, skills,
 * trust bars) applied to the project, with the installing person accountable.
 *
 * Run as the person's action — a press on the Company page, or the Create on a
 * chat card — and REVERSIBLE AS ONE UNIT: `undo` puts every file it wrote back
 * (a file someone changed since is kept, and named), applies again so the
 * agents, missions and automations it brought retire and the trust bars return
 * to what they were, and removes the teams and budget rows it created. Internal:
 * nothing leaves the workspace.
 */

import type { Action, ReviewCard } from './types';
import { z } from 'zod';

const SLUG = /^[a-z][a-z0-9_-]*$/;

const appsInstallInput = z.object({
  appId: z.string().regex(SLUG).max(60),
  /** A shipped template, by slug — or carry a `plan`. */
  template: z.string().regex(SLUG).max(60).optional(),
  /** The template's interview answers, by question key. */
  answers: z.record(z.string(), z.string().max(2000)).default({}),
  /** A drafted plan, as previewed and edited (`FunctionPlanSchema`). Validated at the door. */
  plan: z.record(z.string(), z.unknown()).optional(),
}).refine(i => Boolean(i.template) !== Boolean(i.plan), { message: 'name a template or carry a plan — one of the two' });

export type AppsInstallInput = z.infer<typeof appsInstallInput>;

/**
 * The person whose install this is: the one who approved it, else the one who
 * asked. An agent is never accountable for a function.
 * @param ctx - The action context.
 * @param ctx.reviewedBy - Who approved it, when it came through a card.
 * @param ctx.invokedBy - Who proposed it.
 */
async function installerOf(ctx: { reviewedBy?: string; invokedBy?: string }): Promise<{ id: string; email: string; name: string } | null> {
  const candidate = [ctx.reviewedBy, ctx.invokedBy].find(id => id && !id.includes(':'));
  if (!candidate) {
    return null;
  }
  const [{ db }, { eq }, { userSchema }] = await Promise.all([import('@/libs/DB'), import('drizzle-orm'), import('@/models/Schema')]);
  const [row] = await db.select({ id: userSchema.id, email: userSchema.email, name: userSchema.name }).from(userSchema).where(eq(userSchema.id, candidate)).limit(1);
  return row?.email ? { id: row.id, email: row.email, name: row.name ?? row.email } : null;
}

export const appsInstallAction: Action<typeof appsInstallInput> = {
  id: 'apps.install',
  name: 'Stand up a function',
  description: 'Stand a whole function up in this workspace from an app\'s template ({ appId, template, answers }) or a drafted plan ({ appId, plan }): its teams with a lead and specialists, measures, missions, automations, conservative trust bars and budgets, as the workspace\'s own files, with the person accountable. Reversible as one unit.',
  inputSchema: appsInstallInput,
  grant: 'manage_workspace',
  external: false,
  // A person stands a function up; an agent may only offer it, as a card.
  approvalRequired: true,
  holdForPerson: async () => 'a function is stood up by a person — an agent offers it, and the person who creates it is accountable for it',

  async precheck(ctx, input) {
    const { AppTemplateError, checkedPlan, templateWriteTarget } = await import('@/services/apps/AppTemplateService');
    const target = await templateWriteTarget(ctx.orgId);
    if (!target.ok) {
      return target.reason;
    }
    if (input.template) {
      const { listAppTemplateSlugs } = await import('@/libs/workspace/appTemplates');
      if (!listAppTemplateSlugs(input.appId).includes(input.template)) {
        return `app "${input.appId}" has no template "${input.template}"`;
      }
      return undefined;
    }
    try {
      checkedPlan(input.appId, input.plan);
    } catch (error) {
      return error instanceof AppTemplateError ? `the plan cannot be created as it stands: ${error.message}` : String(error);
    }
    return undefined;
  },

  async reviewCard(_ctx, input): Promise<ReviewCard> {
    if (input.plan) {
      const plan = input.plan as { name?: string; summary?: string; teams?: Array<{ name: string }>; agents?: Array<{ name: string; source?: { kind?: string } }>; missions?: Array<{ name: string }>; automations?: Array<{ name: string }> };
      const reused = (plan.agents ?? []).filter(a => a.source?.kind === 'catalog').length;
      return {
        title: `Stand up ${plan.name ?? 'a function'}`,
        system: 'Company',
        headline: `Create ${plan.name ?? 'this function'} in this workspace — you are accountable for it.`,
        badges: [{ label: 'Undo as one unit' }],
        summary: plan.summary,
        fields: [
          { label: 'Teams', value: (plan.teams ?? []).map(t => t.name).join(', ') },
          { label: 'Agents', value: `${(plan.agents ?? []).map(a => a.name).join(', ')}${reused > 0 ? ` (${reused} hired from the catalog)` : ''}` },
          { label: 'Missions', value: (plan.missions ?? []).map(m => m.name).join(', ') },
          ...((plan.automations ?? []).length > 0 ? [{ label: 'Automations', value: plan.automations!.map(a => a.name).join(', ') }] : []),
        ],
        nextAction: 'Creating writes these into the workspace as its own files and applies them. Undo puts it all back.',
        verbs: { approve: 'Create', reject: 'Not now' },
      };
    }
    const { loadAppTemplate } = await import('@/libs/workspace/appTemplates');
    const template = loadAppTemplate(input.appId, input.template!);
    return {
      title: `Stand up ${template.manifest.name}`,
      system: 'Company',
      headline: `Set up ${template.manifest.name} in this workspace — you are accountable for it.`,
      badges: [{ label: 'Undo as one unit' }],
      summary: template.manifest.description,
      fields: template.manifest.includes.map((line, i) => ({ label: i === 0 ? 'Includes' : '', value: line })),
      nextAction: 'Setting it up writes its files into the workspace and applies them. Undo puts it all back.',
      verbs: { approve: 'Set it up', reject: 'Not now' },
    };
  },

  async execute(ctx, input) {
    const installer = await installerOf(ctx);
    if (!installer) {
      throw new Error('A function is stood up by a person — there is no one here to be accountable for it.');
    }
    const svc = await import('@/services/apps/AppTemplateService');
    const appliedBy = `user:${installer.id}`;
    const receipt = input.template
      ? await svc.installAppTemplateForProject({ orgId: ctx.orgId, appId: input.appId, templateSlug: input.template, answers: input.answers, installer, appliedBy })
      : await svc.installFunctionPlanForProject({ orgId: ctx.orgId, appId: input.appId, plan: input.plan, installer, appliedBy });
    return receipt as unknown as Record<string, unknown>;
  },

  async undo(ctx, _input, result) {
    const undo = (result as { undo?: import('@/services/apps/AppTemplateService').InstallUndo }).undo;
    if (!undo || !Array.isArray(undo.writes)) {
      throw new Error('This run recorded nothing to put back.');
    }
    const { undoInstall } = await import('@/services/apps/AppTemplateService');
    const done = await undoInstall({ orgId: ctx.orgId, undo, appliedBy: ctx.invokedBy ?? 'undo' });
    return done as unknown as Record<string, unknown>;
  },
};
