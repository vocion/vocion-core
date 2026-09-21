/**
 * team.hire_agent — an agent adds a teammate, within a budget.
 *
 * The one act "the team extends itself" actually is. Everything around it
 * already existed: the catalog is the library of roles
 * (`services/CatalogService.ts`), `agent_budget` is the allowance, the trust
 * ladder decides who may release it, and the review card is how a person sees
 * it before it happens. What was missing was the act itself — until now a
 * role was added by a human editing YAML, or by an agent writing a paragraph
 * in a report and hoping somebody read it. Governance by report is not
 * governance; this puts the hire on the same ladder as every other write.
 *
 * Three things make it safe, and none of them is the prompt:
 *
 * 1. **It can only hire what already exists.** The input is a catalog slug, so
 *    the definition being installed was authored and reviewed by whoever ships
 *    the catalog. An agent cannot invent a teammate, only pick one.
 * 2. **It cannot hire without saying what the teammate may spend.**
 *    `dailyCentsLimit` is required and becomes the new agent's `agent_budget`
 *    soft and hard caps for the day. A teammate with no allowance is the
 *    failure mode this whole action exists to avoid: capability added, cost
 *    discovered later.
 * 3. **It refuses while the workspace is already over its allowance.** The
 *    precheck sums every agent budget that declares a cents limit
 *    (`BudgetService.workspaceHeadroom`) and will not open a card when the
 *    period's spend has reached the committed total. You do not add a mouth to
 *    feed while the ones you have are over.
 *
 * Reversible: undo removes the agent row, the budget row, and the team row if
 * this hire created it. That is what earns it a place in the self-improvement
 * class (`libs/actions/selfUpdate.ts`) — but it is NOT on the learning
 * eagerness dial. That dial is calibrated for "an agent read a sentence nobody
 * meant"; hiring changes what the system can DO, the same reason
 * `plugin.enable` stays off it. It sits a tier higher than `plugin.enable`
 * (`medium`, so the ladder's ceiling is execute-within-bounds and autonomous
 * is never on offer) because a plugin's agents are shipped and versioned
 * together while a hire is a standing teammate that will take turns, spend
 * money and act under the workspace's name from the moment it lands.
 */

import type { Action, ActionContext } from './types';
import { z } from 'zod';

const hireAgentInput = z.object({
  /** The catalog entry's slug — `seo-specialist`, `claim-adversary`. */
  slug: z.string().min(1).max(80),
  /**
   * What this teammate may spend per day, in cents. Required: the allowance
   * is part of the hire, not a thing somebody sets afterwards. Written as both
   * the soft and the hard daily cap, so the first day cannot run away while
   * nobody is looking; a workspace loosens it afterwards on the budgets page.
   */
  dailyCentsLimit: z.number().int().positive().max(1_000_000),
  /**
   * Why this role, now — the gap it fills and the work waiting on it. Read on
   * the card and kept on the run; a hire nobody can justify in a sentence is a
   * hire nobody should release.
   */
  reason: z.string().min(1).max(500),
});

export type HireAgentInput = z.infer<typeof hireAgentInput>;

/**
 * cents → `$12.34`, for the card and the refusals.
 * @param cents - A whole number of cents.
 */
function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

async function catalog() {
  return import('@/services/CatalogService');
}

export const teamHireAgentAction: Action<typeof hireAgentInput> = {
  id: 'team.hire_agent',
  name: 'Hire a teammate from the catalog',
  description: 'Add a catalog role to this workspace as a working agent, with the daily spend allowance it is hired under. Reversible — undo removes the agent, its budget and the team the hire created. Refused while the workspace is already over its committed spend for the period.',
  inputSchema: hireAgentInput,
  grant: 'manage_workspace',
  external: false,
  dedupKeyFor: input => `team.hire_agent:${input.slug}`,
  // One decision per role: a person who said no to hiring this role should not
  // be asked again next week by the same weekly pass.
  dedupAgainstDecided: { statuses: ['done', 'rejected'], reproposeAfterDays: 30 },

  async precheck(ctx, input) {
    const { getCatalogEntry, listCatalog } = await catalog();
    const entry = getCatalogEntry(input.slug);
    if (!entry) {
      const known = listCatalog().map(e => e.slug);
      return `no catalog role "${input.slug}" — the catalogue has ${known.length} roles, including ${known.slice(0, 6).join(', ')}`;
    }

    const { agentSchema } = await import('@/models/Schema');
    const { db } = await import('@/libs/DB');
    const { eq } = await import('drizzle-orm');
    const existing = await db.select({ slug: agentSchema.slug }).from(agentSchema).where(eq(agentSchema.orgId, ctx.orgId));
    if (existing.some(a => a.slug === input.slug)) {
      return `${entry.name} is already on this team — there is nothing to hire`;
    }

    // The budget gate. A card that would be refused at execute time teaches
    // nobody anything, so the refusal happens before a person is asked.
    const { workspaceHeadroom } = await import('@/services/BudgetService');
    const headroom = await workspaceHeadroom(ctx.orgId, 'daily');
    if (headroom.overSoft) {
      return `this workspace has spent ${money(headroom.spentCents)} of its ${money(headroom.committedCents)} daily allowance across ${headroom.agents} agents, so there is nothing to hire ${entry.name} with. Raise the allowance on /dashboard/budgets, or retire a role, before adding one.`;
    }
    if (headroom.committedCents > 0 && input.dailyCentsLimit > headroom.headroomCents) {
      return `${entry.name} is asked for at ${money(input.dailyCentsLimit)} a day and only ${money(headroom.headroomCents)} of the workspace's ${money(headroom.committedCents)} daily allowance is unspent. Ask for less, or raise the allowance first.`;
    }
    return undefined;
  },

  async reviewCard(ctx, input) {
    const { getCatalogEntry } = await catalog();
    const { workspaceHeadroom } = await import('@/services/BudgetService');
    const [entry, headroom] = await Promise.all([
      Promise.resolve(getCatalogEntry(input.slug)),
      workspaceHeadroom(ctx.orgId, 'daily'),
    ]);
    const name = entry?.name ?? input.slug;
    return {
      title: `Hire ${name}`,
      system: 'Team',
      headline: `Add ${name} to ${entry?.teamName ?? 'this workspace'} at ${money(input.dailyCentsLimit)} a day.`,
      badges: [
        { label: 'Reversible' },
        { label: `${money(input.dailyCentsLimit)}/day` },
        ...(headroom.committedCents > 0 ? [{ label: `${money(headroom.headroomCents)} unspent today` }] : []),
      ],
      summary: input.reason,
      fields: [
        { label: 'Role', value: `${name} — ${entry?.description ?? 'no description'}`, href: `/dashboard/marketplace/${input.slug}` },
        { label: 'Team', value: entry?.teamName ?? entry?.team ?? 'none — it will sit in the unassigned strip' },
        { label: 'Composes', value: entry && entry.skills.length > 0 ? `${entry.skills.length} skills — ${entry.skills.join(', ')}` : 'no skills; the system prompt is the whole definition' },
        { label: 'Reaches for', value: entry && entry.optional.length > 0 ? `${entry.optional.join(', ')} when connected; works from files with none` : 'nothing — works from files' },
        {
          label: 'Allowance',
          value: headroom.committedCents > 0
            ? `${money(input.dailyCentsLimit)} a day, soft and hard. The workspace has committed ${money(headroom.committedCents)} a day across ${headroom.agents} agents and spent ${money(headroom.spentCents)} of it.`
            : `${money(input.dailyCentsLimit)} a day, soft and hard. No other agent here has a budget, so this is the only capped one.`,
        },
      ],
      links: [{ label: 'Budgets', href: '/dashboard/budgets' }],
      nextAction: `Hiring creates the agent from the catalog definition, opens its team if this workspace has none, and caps it at ${money(input.dailyCentsLimit)} a day. Undo removes all three.`,
      verbs: { approve: 'Hire', reject: 'Not now' },
    };
  },

  async execute(ctx, input) {
    const { hire } = await catalog();
    const res = await hire(ctx.orgId, input.slug);
    if (res.status !== 'hired') {
      // `already` and `unknown` are both refusals the precheck should have
      // caught; reaching here means the workspace changed under the card.
      return { status: res.status, slug: input.slug, hired: false };
    }
    const { setLimits } = await import('@/services/BudgetService');
    await setLimits({
      orgId: ctx.orgId,
      agentSlug: input.slug,
      period: 'daily',
      softCentsLimit: input.dailyCentsLimit,
      hardCentsLimit: input.dailyCentsLimit,
    });
    return {
      status: res.status,
      hired: true,
      slug: input.slug,
      name: res.entry?.name ?? input.slug,
      team: res.entry?.team ?? null,
      // Undo reads this: only a team this hire brought into existence goes back.
      teamCreated: res.teamCreated,
      dailyCentsLimit: input.dailyCentsLimit,
    };
  },

  async undo(ctx: ActionContext, input, result) {
    if (result.hired !== true) {
      return { undone: false, reason: 'the hire did not happen' };
    }
    const { db } = await import('@/libs/DB');
    const { and, eq } = await import('drizzle-orm');
    const { agentSchema, teamSchema } = await import('@/models/Schema');
    const { removeBudget } = await import('@/services/BudgetService');

    await db.delete(agentSchema).where(and(eq(agentSchema.orgId, ctx.orgId), eq(agentSchema.slug, input.slug)));
    await removeBudget({ orgId: ctx.orgId, agentSlug: input.slug, period: 'daily' });
    const teamCreated = typeof result.teamCreated === 'string' ? result.teamCreated : null;
    if (teamCreated) {
      await db.delete(teamSchema).where(and(eq(teamSchema.orgId, ctx.orgId), eq(teamSchema.slug, teamCreated)));
    }
    return { undone: true, slug: input.slug, budgetRemoved: true, teamRemoved: teamCreated };
  },
};
