/**
 * org.change — a change to the team itself, proposed on its evidence.
 *
 * The weekly org review (`services/orgReview`) reads what the workspace
 * already stores — the decisions people took on each agent's proposals, what
 * each agent spent, which agents have not run, what they keep escalating, how
 * each team is doing against its measures — and files what it finds here:
 * retire an agent nobody uses, re-scope one by its budget, hire a role a
 * struggling team lacks, or adopt a standing rule for a pattern people keep
 * correcting. Inspired by a weekly "manager" pass, shaped by earned autonomy:
 * it proposes, a person decides, and nothing about the team changes silently.
 *
 * One action, four ledgers. The change's kind is the ladder key
 * (`org.change.retire_agent`, `org.change.set_budget`, …), so a workspace can
 * let budget re-scopes earn their way while retirements always ask; a rule on
 * the bare `org.change` covers every kind that has none of its own. The kind
 * is `medium` risk, so with nothing said it waits for a person whatever the
 * confidence (`libs/actions/autoAccept.ts`).
 *
 * The evidence is core's, never a model's. `evidence` is internal input: the
 * review fills it from the rows it read, each line linking to where a person
 * can check it (principle 10), and it is stripped from any other proposer. An
 * agent cannot file an org change on its own say-so — it would arrive with no
 * evidence and is refused — while a person asking for one themselves is not
 * held to it: the person's word runs.
 *
 * Every kind is reversible, and acting on it records what Undo needs:
 *
 *   - `retire_agent` — the agent goes inactive (the state apply gives an agent
 *     the workspace stopped shipping) under a person's hold that apply keeps
 *     (`agent.paused_*`). Undo restores `active` and lifts the hold.
 *   - `set_budget` — the agent's daily caps change. Undo writes the previous
 *     caps back exactly.
 *   - `hire_agent` — a catalog role is hired with its allowance
 *     (`team.hire_agent`'s act). Undo removes it.
 *   - `adopt_rule` — a standing rule is adopted through the feedback loop's
 *     own pipeline (`learning.adopt_rule`'s act: duplicate judge, occurrence
 *     counting). Undo un-adopts it.
 */

import type { Action, ActionContext } from './types';
import { z } from 'zod';
import { learningAdoptRuleAction } from './learning-adopt-rule';
import { teamHireAgentAction } from './team-hire-agent';

/** What raised a proposal — the review's typed finding, never a word match. */
export const ORG_SIGNALS = ['idle', 'spend', 'rejections', 'escalations', 'measures'] as const;
export type OrgSignal = typeof ORG_SIGNALS[number];

export const ORG_CHANGE_KINDS = ['retire_agent', 'set_budget', 'hire_agent', 'adopt_rule'] as const;
export type OrgChangeKind = typeof ORG_CHANGE_KINDS[number];

const slug = z.string().min(1).max(120);

/** One line of evidence: what was read, and where a person reads it too. */
export const orgEvidenceItem = z.object({
  label: z.string().min(1).max(80),
  value: z.string().min(1).max(400),
  /** An app path (`/dashboard/team-report/<slug>`) or an absolute URL. */
  href: z.string().max(500).optional(),
});
export type OrgEvidenceItem = z.infer<typeof orgEvidenceItem>;

export const orgChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('retire_agent'), agentSlug: slug }),
  z.object({
    kind: z.literal('set_budget'),
    agentSlug: slug,
    /** The new hard daily cap, in cents (also written as the soft cap). */
    dailyCents: z.number().int().min(0).max(1_000_000),
  }),
  z.object({
    kind: z.literal('hire_agent'),
    /** A catalog role's slug — the review only ever offers roles the catalog ships. */
    catalogSlug: slug,
    dailyCents: z.number().int().positive().max(1_000_000),
  }),
  z.object({
    kind: z.literal('adopt_rule'),
    /** The agent the rule is about; its own first learning step receives it. */
    agentSlug: slug.optional(),
    stepName: z.string().min(1).max(120).optional(),
    ruleText: z.string().min(8).max(600),
  }),
]);
export type OrgChange = z.infer<typeof orgChangeSchema>;

const orgChangeInput = z.object({
  change: orgChangeSchema,
  /** One sentence: what approving does and why, e.g. "Retire Kestrel Scout — no runs in 41 days." */
  headline: z.string().min(1).max(200),
  /** The case for it, a few sentences a person can check against the evidence. */
  reason: z.string().min(1).max(1_000),
  /** Which finding raised it. */
  signal: z.enum(ORG_SIGNALS).optional(),
  /** What the review read, each line linked to where a person can check it. Core's own input. */
  evidence: z.array(orgEvidenceItem).max(16).default([]),
  /** When the evidence was read, ISO — anything dated is shown with its date. */
  asOf: z.string().datetime().optional(),
});

export type OrgChangeInput = z.infer<typeof orgChangeInput>;

/** What each kind is called on the card and the ladder. */
export const ORG_CHANGE_LABEL: Readonly<Record<OrgChangeKind, string>> = {
  retire_agent: 'Retire an agent',
  set_budget: 'Re-scope a budget',
  hire_agent: 'Hire a role',
  adopt_rule: 'Adopt a standing rule',
};

/** One word each: the review bar puts the approve verb in the past tense ("Retired · …"). */
const APPROVE_VERB: Readonly<Record<OrgChangeKind, string>> = {
  retire_agent: 'Retire',
  set_budget: 'Adjust',
  hire_agent: 'Hire',
  adopt_rule: 'Adopt',
};

/**
 * The thing a change is about, for its dedup key: one open proposal per agent
 * and kind, per role, per rule.
 * @param change - The change.
 */
export function orgChangeTarget(change: OrgChange): string {
  switch (change.kind) {
    case 'hire_agent':
      return change.catalogSlug;
    case 'adopt_rule':
      return `${change.agentSlug ?? 'workspace'}:${change.ruleText.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)}`;
    default:
      return change.agentSlug;
  }
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

async function agentRow(orgId: string, slug: string) {
  const [{ db }, { agentSchema }, { and, eq }] = await Promise.all([
    import('@/libs/DB'),
    import('@/models/Schema'),
    import('drizzle-orm'),
  ]);
  const [row] = await db
    .select({ slug: agentSchema.slug, name: agentSchema.name, active: agentSchema.active, pausedAt: agentSchema.pausedAt, pausedBy: agentSchema.pausedBy, pausedNote: agentSchema.pausedNote })
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, slug)))
    .limit(1);
  return row ?? null;
}

async function workspaceLead(orgId: string): Promise<string | null> {
  const [{ db }, { projectSchema }, { eq }] = await Promise.all([
    import('@/libs/DB'),
    import('@/models/Schema'),
    import('drizzle-orm'),
  ]);
  const [row] = await db.select({ lead: projectSchema.leadAgentSlug }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  return row?.lead ?? null;
}

/**
 * The hire input `team.hire_agent` reads, from this change.
 * @param input - The org change.
 * @param change - Its hire.
 */
function hireInput(input: OrgChangeInput, change: Extract<OrgChange, { kind: 'hire_agent' }>) {
  return { slug: change.catalogSlug, dailyCentsLimit: change.dailyCents, reason: input.reason.slice(0, 500) };
}

/**
 * The adoption input `learning.adopt_rule` reads, from this change.
 * @param ctx - Who decided it.
 * @param input - The org change.
 * @param change - Its rule.
 */
function adoptInput(ctx: ActionContext, input: OrgChangeInput, change: Extract<OrgChange, { kind: 'adopt_rule' }>) {
  const note = [input.headline, ...input.evidence.map(e => `${e.label}: ${e.value}`)].join('\n').slice(0, 2000);
  return {
    ruleText: change.ruleText,
    ...(change.stepName ? { stepName: change.stepName } : {}),
    ...(change.agentSlug ? { agentSlug: change.agentSlug } : {}),
    polarity: 'correct' as const,
    memoryType: 'procedure' as const,
    note,
    submittedBy: ctx.reviewedBy ?? 'org-review',
    reason: input.reason.slice(0, 500),
  };
}

export const orgChangeAction: Action<typeof orgChangeInput> = {
  id: 'org.change',
  name: 'Change the team',
  description: 'Retire an agent, re-scope its daily budget, hire a catalog role, or adopt a standing rule — a change to the team itself, filed by the weekly org review with the evidence that raised it. Reversible: Undo puts the team back as it was.',
  inputSchema: orgChangeInput,
  grant: 'manage_workspace',
  external: false,
  // Only core's review cites evidence: a model's card cannot invent it.
  internalInput: ['evidence'],
  policyKeyFor: input => `org.change.${input.change.kind}`,
  // One rule on `org.change` covers every kind until a kind earns its own.
  parentRuleGoverns: true,
  dedupKeyFor: input => `org.change:${input.change.kind}:${orgChangeTarget(input.change)}`,
  // A person who declined a change is not asked again by next week's review;
  // one that was made is given a month to show its effect.
  dedupAgainstDecided: { statuses: ['done', 'rejected'], reproposeAfterDays: 30 },

  async precheck(ctx, input) {
    // An agent's own org change needs evidence it cannot write; a person
    // asking for one themselves is their word, and runs.
    if (input.evidence.length === 0 && ctx.proposedBy?.startsWith('agent:')) {
      return 'an org change has to cite the evidence that raised it, and only the weekly org review can — ask a person, or wait for the review to find it';
    }
    const change = input.change;
    switch (change.kind) {
      case 'retire_agent': {
        const agent = await agentRow(ctx.orgId, change.agentSlug);
        if (!agent) {
          return `no agent "${change.agentSlug}" in this workspace`;
        }
        if (agent.active === 'false') {
          return `${agent.name} is already inactive — there is nothing to retire`;
        }
        if (await workspaceLead(ctx.orgId) === change.agentSlug) {
          return `${agent.name} is this workspace's lead, which answers every message nobody addressed — name a new lead in workspace.yaml before retiring it`;
        }
        return undefined;
      }
      case 'set_budget':
        return (await agentRow(ctx.orgId, change.agentSlug)) ? undefined : `no agent "${change.agentSlug}" in this workspace`;
      case 'hire_agent':
        return teamHireAgentAction.precheck ? teamHireAgentAction.precheck(ctx, hireInput(input, change)) : undefined;
      default:
        return undefined;
    }
  },

  async reviewCard(ctx, input) {
    const change = input.change;
    const fields: Array<{ label: string; value: string; href?: string }> = [];
    let nextAction: string;
    switch (change.kind) {
      case 'retire_agent': {
        const agent = await agentRow(ctx.orgId, change.agentSlug);
        fields.push({ label: 'Agent', value: `${agent?.name ?? change.agentSlug} (${change.agentSlug})`, href: `/dashboard/agents/${change.agentSlug}` });
        nextAction = 'Retiring makes the agent inactive and holds it there across workspace applies: it is no longer routed to and takes no turns. Undo brings it back as it was.';
        break;
      }
      case 'set_budget': {
        const { getBudget } = await import('@/services/BudgetService');
        const current = await getBudget({ orgId: ctx.orgId, agentSlug: change.agentSlug, period: 'daily' }).catch(() => null);
        const was = current?.hardCentsLimit;
        fields.push({ label: 'Agent', value: change.agentSlug, href: `/dashboard/agents/${change.agentSlug}` });
        fields.push({ label: 'Daily cap', value: `${was === null || was === undefined ? 'the workspace default' : money(was)} → ${money(change.dailyCents)}` });
        nextAction = `Adjusting sets the agent's daily cap to ${money(change.dailyCents)}, soft and hard. Undo writes the previous caps back.`;
        break;
      }
      case 'hire_agent': {
        const { getCatalogEntry } = await import('@/services/CatalogService');
        const entry = getCatalogEntry(change.catalogSlug);
        fields.push({ label: 'Role', value: `${entry?.name ?? change.catalogSlug} — ${entry?.description ?? 'a catalog role'}`, href: `/dashboard/hire/${change.catalogSlug}` });
        fields.push({ label: 'Allowance', value: `${money(change.dailyCents)} a day, soft and hard` });
        nextAction = `Hiring adds ${entry?.name ?? change.catalogSlug} from the catalog at ${money(change.dailyCents)} a day. Undo removes it, its budget and any team the hire created.`;
        break;
      }
      default: {
        fields.push({ label: 'Rule', value: change.ruleText });
        if (change.agentSlug) {
          fields.push({ label: 'Agent', value: change.agentSlug, href: `/dashboard/agents/${change.agentSlug}` });
        }
        nextAction = 'Adopting files the rule in the agent\'s learning step; it reads it before its next piece of work. A rule already on file raises its count instead. Undo removes it.';
      }
    }
    // The evidence, line by line, each one move from where it is read.
    fields.push(...input.evidence.map(e => ({ label: e.label, value: e.value, ...(e.href ? { href: e.href } : {}) })));
    const asOf = input.asOf ? new Date(input.asOf) : null;
    return {
      title: input.headline,
      system: 'Org review',
      headline: input.headline.slice(0, 140),
      badges: [
        { label: ORG_CHANGE_LABEL[change.kind] },
        { label: 'Reversible' },
        ...(asOf && !Number.isNaN(asOf.getTime()) ? [{ label: `Evidence as of ${asOf.toISOString().slice(0, 10)}` }] : []),
      ],
      confidenceSubject: 'This change is right',
      summary: input.reason,
      fields,
      links: [{ label: 'Team report', href: '/dashboard/team-report' }],
      nextAction,
      verbs: { approve: APPROVE_VERB[change.kind], reject: 'Decline' },
    };
  },

  async execute(ctx, input) {
    const change = input.change;
    switch (change.kind) {
      case 'retire_agent': {
        const agent = await agentRow(ctx.orgId, change.agentSlug);
        if (!agent) {
          throw new Error(`no agent "${change.agentSlug}" in this workspace`);
        }
        const [{ db }, { agentSchema }, { and, eq }] = await Promise.all([import('@/libs/DB'), import('@/models/Schema'), import('drizzle-orm')]);
        const by = ctx.reviewedBy ?? ctx.invokedBy ?? 'org-review';
        await db
          .update(agentSchema)
          .set({ active: 'false', pausedAt: new Date(), pausedBy: by, pausedNote: input.headline.slice(0, 500) })
          .where(and(eq(agentSchema.orgId, ctx.orgId), eq(agentSchema.slug, change.agentSlug)));
        return {
          kind: change.kind,
          agentSlug: change.agentSlug,
          agentName: agent.name,
          retired: true,
          // Undo reads these: the agent comes back exactly as it was.
          previousActive: agent.active ?? 'true',
          previousPause: agent.pausedAt ? { at: agent.pausedAt.toISOString(), by: agent.pausedBy, note: agent.pausedNote } : null,
          href: `/dashboard/agents/${change.agentSlug}`,
        };
      }
      case 'set_budget': {
        const { getBudget, setLimits } = await import('@/services/BudgetService');
        const before = await getBudget({ orgId: ctx.orgId, agentSlug: change.agentSlug, period: 'daily' });
        await setLimits({
          orgId: ctx.orgId,
          agentSlug: change.agentSlug,
          period: 'daily',
          softTokenLimit: before?.softTokenLimit ?? null,
          hardTokenLimit: before?.hardTokenLimit ?? null,
          softCentsLimit: change.dailyCents,
          hardCentsLimit: change.dailyCents,
        });
        return {
          kind: change.kind,
          agentSlug: change.agentSlug,
          dailyCents: change.dailyCents,
          hadRow: Boolean(before),
          previous: {
            softCentsLimit: before?.softCentsLimit ?? null,
            hardCentsLimit: before?.hardCentsLimit ?? null,
          },
          href: `/dashboard/team-report/${change.agentSlug}`,
        };
      }
      case 'hire_agent':
        return { kind: change.kind, ...await teamHireAgentAction.execute(ctx, hireInput(input, change)) };
      default:
        return { kind: change.kind, ...await learningAdoptRuleAction.execute(ctx, adoptInput(ctx, input, change)) };
    }
  },

  async undo(ctx, input, result) {
    const change = input.change;
    switch (change.kind) {
      case 'retire_agent': {
        if (result.retired !== true) {
          return { undone: false, reason: 'the agent was not retired' };
        }
        const [{ db }, { agentSchema }, { and, eq }] = await Promise.all([import('@/libs/DB'), import('@/models/Schema'), import('drizzle-orm')]);
        const prev = (result.previousPause ?? null) as { at?: string; by?: string | null; note?: string | null } | null;
        await db
          .update(agentSchema)
          .set({
            active: typeof result.previousActive === 'string' ? result.previousActive : 'true',
            pausedAt: prev?.at ? new Date(prev.at) : null,
            pausedBy: prev?.by ?? null,
            pausedNote: prev?.note ?? null,
          })
          .where(and(eq(agentSchema.orgId, ctx.orgId), eq(agentSchema.slug, change.agentSlug)));
        return { undone: true, agentSlug: change.agentSlug };
      }
      case 'set_budget': {
        const { removeBudget, getBudget, setLimits } = await import('@/services/BudgetService');
        const prev = (result.previous ?? {}) as { softCentsLimit?: number | null; hardCentsLimit?: number | null };
        if (result.hadRow === false) {
          // The change created the row; without it the agent is back on the
          // default cap. The period's spend counter goes with it, which is what
          // a row that never existed held.
          await removeBudget({ orgId: ctx.orgId, agentSlug: change.agentSlug, period: 'daily' });
          return { undone: true, agentSlug: change.agentSlug, budgetRemoved: true };
        }
        const now = await getBudget({ orgId: ctx.orgId, agentSlug: change.agentSlug, period: 'daily' });
        await setLimits({
          orgId: ctx.orgId,
          agentSlug: change.agentSlug,
          period: 'daily',
          softTokenLimit: now?.softTokenLimit ?? null,
          hardTokenLimit: now?.hardTokenLimit ?? null,
          softCentsLimit: prev.softCentsLimit ?? null,
          hardCentsLimit: prev.hardCentsLimit ?? null,
        });
        return { undone: true, agentSlug: change.agentSlug, restored: prev };
      }
      case 'hire_agent':
        return (await teamHireAgentAction.undo?.(ctx, hireInput(input, change), result)) ?? { undone: false };
      default:
        return (await learningAdoptRuleAction.undo?.(ctx, adoptInput(ctx, input, change), result)) ?? { undone: false };
    }
  },
};
