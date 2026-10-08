/**
 * `draft_function_plan` — describe-your-own from chat.
 *
 * A person tells an agent what function they want ("a two-person bookkeeping
 * practice for restaurants…"); the agent drafts the plan through the same
 * service the Company page uses (`FunctionDraftService`, typed and charged),
 * and puts it in front of them as ONE card: Create stands it up through the
 * same `apps.install` a template uses, as the person's decision, undoable as
 * one unit. Nothing is created by the tool itself. The card links to the app's
 * page, where the same plan can be drafted and edited in full.
 *
 * Present while an app with a blank start is installed in the workspace (its
 * plugin is on). The onboarding card that offers "Start from a template" can
 * offer "Describe your own" through this tool's name or `blankStartHref`.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { safeListApps } from '@/libs/workspace/apps';
import { userSchema } from '@/models/Schema';

export const DRAFT_FUNCTION_TOOL = 'draft_function_plan';

/**
 * Where an app's blank start lives — the hook a chat card offering
 * "Describe your own" links to.
 * @param appId - The app.
 */
export function blankStartHref(appId: string): string {
  return `/dashboard/apps/${appId}?start=blank`;
}

/**
 * The apps this workspace has that start blank.
 * @param enabledPlugins - The workspace's plugins, when known.
 */
function blankApps(enabledPlugins: readonly string[] | undefined) {
  if (!enabledPlugins) {
    return [];
  }
  return safeListApps().filter(a => a.blank && !a.hidden && a.plugins.some(p => enabledPlugins.includes(p)));
}

export function draftFunctionTool(ctx: RuntimeContext) {
  const apps = blankApps(ctx.enabledPlugins);
  if (apps.length === 0) {
    return [];
  }
  const ids = apps.map(a => a.id) as [string, ...string[]];
  return [tool(
    async ({ app, description, answers }) => {
      const appId = app ?? ids[0];
      const person = ctx.userId && !ctx.userId.includes(':')
        ? (await db.select({ email: userSchema.email, name: userSchema.name }).from(userSchema).where(eq(userSchema.id, ctx.userId)).limit(1))[0]
        : undefined;
      if (!person?.email) {
        return 'A function is stood up by a person, and there is no person in this conversation to be accountable for it. Nothing was drafted.';
      }
      const [{ draftFunctionPlan, FunctionDraftError }, { projectName }] = await Promise.all([
        import('@/services/apps/FunctionDraftService'),
        import('@/services/apps/AppTemplateService'),
      ]);
      try {
        const { plan } = await draftFunctionPlan({
          orgId: ctx.orgId,
          appId,
          description,
          answers: answers ?? {},
          installer: { email: person.email, name: person.name ?? person.email },
          workspaceName: await projectName(ctx.orgId),
        });
        const reused = plan.agents.filter(a => a.source.kind === 'catalog').map(a => a.source.kind === 'catalog' ? a.source.slug : '');
        const counts = `${plan.teams.length} team${plan.teams.length === 1 ? '' : 's'}, ${plan.agents.length} agents${reused.length > 0 ? ` (${reused.length} hired from the catalog: ${reused.join(', ')})` : ''}, ${plan.missions.length} mission${plan.missions.length === 1 ? '' : 's'}, ${plan.automations.length} automation${plan.automations.length === 1 ? '' : 's'}`;
        ctx.emit({
          type: 'recommended_action',
          recommendation: {
            actionId: 'apps.install',
            input: { appId, plan, answers: {} },
            label: `Create ${plan.name}`,
            rationale: `${plan.summary} ${counts}.`,
            confidence: 0.9,
            agentSlug: ctx.agentSlug,
            suggestedDecision: 'approve',
            suggestedDecisionReason: 'Drafted from what you described; nothing is created until you press Create, and Undo puts it all back.',
          },
        });
        return `Drafted "${plan.name}": ${counts}. It is a card in front of the person now — Create stands it up as their decision, undoable as one unit. To rename or remove parts first, they can open ${blankStartHref(appId)}. Say what it is in two lines; do not paste the plan.`;
      } catch (error) {
        if (error instanceof FunctionDraftError) {
          return `No draft: ${error.message}${error.problems ? ` (${Object.entries(error.problems).map(([k, v]) => `${k}: ${v}`).join('; ')})` : ''}. Tell the person in one line, and ask for what is missing.`;
        }
        throw error;
      }
    },
    {
      name: DRAFT_FUNCTION_TOOL,
      description: `Draft a whole business function — teams with a lead and specialists, missions with measures, automations, trust bars and budgets — from the person's own description, and put it in front of them as one card they create with a press (undoable as one unit). Use when a person describes a function or a company they want running that none of the app's templates fits. Reuses catalog roles and plugins where they fit. Apps: ${apps.map(a => `${a.id} (${a.name})`).join(', ')}.`,
      schema: z.object({
        app: z.enum(ids).optional().describe('Which app\'s blank start; defaults to the first'),
        description: z.string().min(20).describe('The function, in the person\'s own words — what it does and for whom'),
        answers: z.record(z.string(), z.string()).optional().describe('The interview: company (its name) and goal (what it should deliver this quarter); omitted ones take their defaults'),
      }),
    },
  )];
}
