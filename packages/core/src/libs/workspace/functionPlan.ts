/**
 * Function plans — what a model drafts when a person starts an app blank.
 *
 * A person describes the function in their own words; a model drafts a PLAN
 * of the same pieces a template ships — teams (a lead and specialists, the
 * installer accountable), each agent's role, goal and prompt, missions with
 * measures, automations with schedules or events, conservative trust bars and
 * a budget on every seat — as TYPED output this schema validates. Nothing in
 * it is parsed from prose. The plan is previewed and edited before anything
 * is created, then rendered into the same workspace files a template writes
 * (`renderFunctionPlan`) and installed through the same path
 * (`services/apps/AppTemplateService.ts`), so a blank start and a template
 * produce the same kind of records (principle 6).
 *
 * A plan prefers what already exists: a catalog role is hired as itself
 * (`source.kind: catalog`, its prompt and skills copied from the catalog), a
 * plugin is turned on as it ships, and the closest template is cited. A new
 * agent is written only where nothing fits. Core names no function here: the
 * app supplies the drafting brief, the catalog and the plugins supply the
 * building blocks, and what is drafted is the workspace's own content.
 */

import type { TemplateFile } from './appTemplates';
import { parse as parseYaml, stringify } from 'yaml';
import { z } from 'zod';
import { AgentManifestSchema, AutomationManifestSchema, MissionManifestSchema, TeamManifestSchema, TrustManifestSchema } from './schemas';

const CRON = /^(?:\S+\s+){4}\S+$/;
const Cron = z.string().regex(CRON, 'a five-field cron, e.g. "0 14 * * 1"');
const PlanSlug = z.string().regex(/^[a-z][a-z0-9-]*$/, 'a lowercase slug of letters, digits and hyphens, e.g. support-lead').max(48);
const CountKey = z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'a camelCase count key, e.g. repliesSent');

/** Where a measure's reading comes from — the measure sources a team file accepts. */
export const MeasurePlanSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'a snake_case key, e.g. customers_answered'),
  label: z.string().min(1).max(80),
  dimension: z.enum(['outcome', 'quality', 'velocity', 'economics']).default('outcome'),
  target: z.number().positive(),
  baseline: z.number().min(0).default(0),
  unit: z.string().min(1).max(20).optional(),
  window: z.enum(['24h', '7d', '30d', 'quarter']).default('7d'),
  direction: z.enum(['higher', 'lower']).default('higher'),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('agent-reported'), counts: CountKey }),
    z.object({ kind: z.literal('observed'), actions: z.array(z.string().min(1)).min(1).max(4) }),
    z.object({ kind: z.literal('human-confirmed'), actions: z.array(z.string().min(1)).min(1).max(4) }),
  ]),
});

export const AgentPlanSchema = z.object({
  slug: PlanSlug,
  name: z.string().min(1).max(60),
  team: PlanSlug,
  /** What this seat owns, in one line — the agent's description. */
  role: z.string().min(1).max(300),
  /** What it is graded on, in one line. */
  goal: z.string().min(1).max(300),
  source: z.discriminatedUnion('kind', [
    /** A catalog role hired as itself: its prompt and skills come from the catalog. */
    z.object({ kind: z.literal('catalog'), slug: PlanSlug, why: z.string().min(1).max(300) }),
    /** A new seat, only where no catalog role fits: its prompt is written here. */
    z.object({ kind: z.literal('new'), systemPrompt: z.string().min(40).max(6000) }),
  ]),
  /** Its daily spend cap, in cents. */
  dailyCents: z.number().int().min(25).max(1000),
});

export const TeamPlanSchema = z.object({
  slug: PlanSlug,
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(400),
  goal: z.string().min(1).max(240),
  /** The agent that leads it — one of the plan's agents on this team. */
  lead: PlanSlug,
  measures: z.array(MeasurePlanSchema).min(1).max(4),
});

export const MissionPlanSchema = z.object({
  slug: PlanSlug,
  name: z.string().min(1).max(100),
  agent: PlanSlug,
  goal: z.string().min(1).max(600),
  successCriteria: z.array(z.string().min(1).max(300)).min(1).max(6),
  schedule: Cron,
});

export const AutomationPlanSchema = z.object({
  slug: PlanSlug,
  name: z.string().min(1).max(100),
  agent: PlanSlug,
  description: z.string().min(1).max(400),
  when: z.union([z.object({ schedule: Cron }), z.object({ event: z.string().regex(/^[a-z][\w-]*\.[\w.-]+$/, 'a typed event, e.g. ask.answered') })]),
  /** The mission this automation keeps — an automation wakes an agent to check one. */
  checkMission: PlanSlug,
  prompt: z.string().min(1).max(1500),
});

export const TrustPlanSchema = z.object({
  action: z.string().min(1),
  rung: z.enum(['observe', 'recommend', 'assist', 'execute-with-approval']),
  autoApproveAbove: z.number().min(0.9).max(1),
  risk: z.enum(['low', 'medium', 'high']).optional(),
  why: z.string().min(1).max(300),
});

/** What a blank start drafts, previews and creates. */
export const FunctionPlanSchema = z.object({
  /** The function's name, e.g. "Northwind Support". */
  name: z.string().min(1).max(80),
  /** Two sentences at most: what it does and how it is judged. */
  summary: z.string().min(1).max(500),
  /** What it reuses rather than writes, each with why. */
  reuse: z.object({
    template: z.object({ slug: PlanSlug, why: z.string().min(1).max(300) }).nullable().default(null),
    plugins: z.array(z.object({ slug: PlanSlug, why: z.string().min(1).max(300) })).max(4).default([]),
  }).default({ template: null, plugins: [] }),
  teams: z.array(TeamPlanSchema).min(1).max(3),
  agents: z.array(AgentPlanSchema).min(1).max(10),
  missions: z.array(MissionPlanSchema).min(1).max(6),
  automations: z.array(AutomationPlanSchema).max(6).default([]),
  trust: z.array(TrustPlanSchema).max(8).default([]),
});
export type FunctionPlan = z.infer<typeof FunctionPlanSchema>;
export type AgentPlan = z.infer<typeof AgentPlanSchema>;

/** What a plan is checked against: the building blocks that exist. */
export type PlanContext = {
  /** Catalog role slugs. */
  catalog: ReadonlySet<string>;
  /** Shipped plugin slugs. */
  plugins: ReadonlySet<string>;
  /** This app's template slugs. */
  templates: ReadonlySet<string>;
  /** Registered action ids, for trust bars and measures. */
  actions: ReadonlySet<string>;
  /** Agent slugs a new seat may not take: every plugin's and every catalog role's. */
  reservedAgents: ReadonlySet<string>;
};

function dupes(slugs: readonly string[]): string[] {
  return [...new Set(slugs.filter((s, i) => slugs.indexOf(s) !== i))];
}

/**
 * Everything wrong with a plan that its schema cannot see, in words a model
 * (on its corrective retry) or a person (on the preview) can act on. Empty is
 * a plan that can be created.
 * @param plan - A parsed plan.
 * @param ctx - The building blocks that exist.
 */
export function planProblems(plan: FunctionPlan, ctx: PlanContext): string[] {
  const problems: string[] = [];
  const teams = new Set(plan.teams.map(t => t.slug));
  const agents = new Map(plan.agents.map(a => [a.slug, a]));
  const missions = new Set(plan.missions.map(m => m.slug));
  for (const [kind, slugs] of [['team', plan.teams.map(t => t.slug)], ['agent', plan.agents.map(a => a.slug)], ['mission', plan.missions.map(m => m.slug)], ['automation', plan.automations.map(a => a.slug)]] as const) {
    for (const d of dupes(slugs)) {
      problems.push(`two ${kind}s share the slug "${d}"`);
    }
  }
  for (const team of plan.teams) {
    const lead = agents.get(team.lead);
    if (!lead) {
      problems.push(`team "${team.slug}" is led by "${team.lead}", which is not one of the plan's agents`);
    } else if (lead.team !== team.slug) {
      problems.push(`team "${team.slug}" is led by "${team.lead}", who sits on team "${lead.team}" — a lead belongs to the team it leads`);
    }
    for (const m of team.measures) {
      if (m.baseline !== 0 && (m.direction === 'higher' ? m.baseline >= m.target : m.baseline <= m.target)) {
        problems.push(`measure "${m.key}" on team "${team.slug}" has its baseline on the wrong side of its target`);
      }
      if (m.source.kind !== 'agent-reported') {
        for (const action of m.source.actions.filter(a => !ctx.actions.has(a))) {
          problems.push(`measure "${m.key}" reads action "${action}", which this core does not register`);
        }
      }
    }
    for (const d of dupes(team.measures.map(m => m.key))) {
      problems.push(`team "${team.slug}" has two measures keyed "${d}"`);
    }
  }
  for (const agent of plan.agents) {
    if (!teams.has(agent.team)) {
      problems.push(`agent "${agent.slug}" sits on team "${agent.team}", which the plan does not have`);
    }
    if (agent.source.kind === 'catalog') {
      if (!ctx.catalog.has(agent.source.slug)) {
        problems.push(`agent "${agent.slug}" cites catalog role "${agent.source.slug}", which the catalog does not have`);
      } else if (agent.source.slug !== agent.slug) {
        problems.push(`agent "${agent.slug}" is the catalog role "${agent.source.slug}" and must keep its slug`);
      }
    } else if (ctx.reservedAgents.has(agent.slug)) {
      problems.push(`new agent "${agent.slug}" takes a slug a catalog role or a plugin already uses — name it differently, or hire that role`);
    }
  }
  for (const mission of plan.missions) {
    if (!agents.has(mission.agent)) {
      problems.push(`mission "${mission.slug}" belongs to "${mission.agent}", which is not one of the plan's agents`);
    }
  }
  for (const automation of plan.automations) {
    if (!agents.has(automation.agent)) {
      problems.push(`automation "${automation.slug}" wakes "${automation.agent}", which is not one of the plan's agents`);
    }
    if (!missions.has(automation.checkMission)) {
      problems.push(`automation "${automation.slug}" keeps mission "${automation.checkMission}", which the plan does not have`);
    }
  }
  for (const rule of plan.trust) {
    if (!ctx.actions.has(rule.action)) {
      problems.push(`trust bar "${rule.action}" names an action this core does not register`);
    }
  }
  for (const d of dupes(plan.trust.map(r => r.action))) {
    problems.push(`two trust bars name "${d}"`);
  }
  for (const p of plan.reuse.plugins.filter(p => !ctx.plugins.has(p.slug))) {
    problems.push(`plugin "${p.slug}" does not ship with this core`);
  }
  if (plan.reuse.template && !ctx.templates.has(plan.reuse.template.slug)) {
    problems.push(`template "${plan.reuse.template.slug}" is not one of this app's templates`);
  }
  return problems;
}

/** Reads the catalog for a hired role: its manifest and its skills' files. */
export type CatalogReader = {
  agentYaml: (slug: string) => string | null;
  /** Every file of one catalog skill, at `skills/<slug>/…`. */
  skillFiles: (slug: string) => TemplateFile[];
};

function yamlFile(path: string, header: string, body: unknown): TemplateFile {
  return { path, content: `${header.split('\n').map(l => `# ${l}`).join('\n')}\n${stringify(body, { lineWidth: 100 })}` };
}

/**
 * The workspace files a plan stands up — the same files a template ships, so
 * the same install path writes them and the same loader validates them.
 * @param plan - The plan, as edited.
 * @param opts - Who installs, and where hired roles come from.
 * @param opts.installer - Accountable for every team.
 * @param opts.installer.email - Their email.
 * @param opts.catalog - Reads a hired role's manifest and skills.
 */
export function renderFunctionPlan(plan: FunctionPlan, opts: { installer: { email: string }; catalog: CatalogReader }): TemplateFile[] {
  const files: TemplateFile[] = [];
  const header = `Drafted for "${plan.name}" from a description, previewed and created by a person.\nEdit it like any file in this workspace.`;
  for (const team of plan.teams) {
    files.push(yamlFile(`teams/${team.slug}.yaml`, header, {
      name: team.name,
      description: team.description,
      goal: team.goal,
      lead: team.lead,
      accountableUser: opts.installer.email,
      measures: team.measures.map(m => ({
        key: m.key,
        label: m.label,
        dimension: m.dimension,
        target: m.target,
        baseline: m.baseline,
        ...(m.unit ? { unit: m.unit } : {}),
        window: m.window,
        direction: m.direction,
        source: m.source,
      })),
    }));
  }
  const skillsCopied = new Set<string>();
  for (const agent of plan.agents) {
    const team = plan.teams.find(t => t.slug === agent.team);
    const seat = `${team?.name ?? agent.team} · ${team?.lead === agent.slug ? 'Lead' : 'Specialist'}`;
    const budget = { dailyCents: agent.dailyCents, monthlyCents: agent.dailyCents * 22 };
    if (agent.source.kind === 'catalog') {
      const raw = opts.catalog.agentYaml(agent.source.slug);
      const manifest = (raw ? parseYaml(raw) : {}) as Record<string, unknown>;
      files.push(yamlFile(`agents/${agent.slug}.yaml`, `${header}\nHired from the catalog role "${agent.source.slug}": ${agent.source.why}`, {
        ...manifest,
        slug: agent.slug,
        name: agent.name,
        team: agent.team,
        eyebrow: seat,
        budget,
      }));
      for (const skill of Array.isArray(manifest.skills) ? (manifest.skills as unknown[]).map(String) : []) {
        if (!skillsCopied.has(skill)) {
          skillsCopied.add(skill);
          files.push(...opts.catalog.skillFiles(skill));
        }
      }
    } else {
      files.push(yamlFile(`agents/${agent.slug}.yaml`, header, {
        slug: agent.slug,
        name: agent.name,
        description: agent.role,
        active: true,
        agentType: 'mission',
        team: agent.team,
        eyebrow: seat,
        budget,
        systemPromptFile: `./${agent.slug}.system-prompt.md`,
      }));
      files.push({ path: `agents/${agent.slug}.system-prompt.md`, content: `${agent.source.systemPrompt.trim()}\n\n## What you are graded on\n\n${agent.goal}\n` });
    }
  }
  for (const mission of plan.missions) {
    files.push(yamlFile(`missions/${mission.slug}.yaml`, header, {
      slug: mission.slug,
      name: mission.name,
      goal: mission.goal,
      agent: mission.agent,
      autonomyPolicy: { level: 2 },
      successCriteria: mission.successCriteria,
      schedule: mission.schedule,
    }));
  }
  for (const automation of plan.automations) {
    files.push(yamlFile(`automations/${automation.slug}.yaml`, header, {
      slug: automation.slug,
      name: automation.name,
      description: automation.description,
      status: 'active',
      agent: automation.agent,
      when: automation.when,
      do: { checkMission: automation.checkMission, prompt: automation.prompt },
    }));
  }
  if (plan.trust.length > 0) {
    files.push(yamlFile('trust.yaml', `Trust bars drafted for "${plan.name}". Every one starts off: a person raises one at a time once the record earns it.`, {
      rules: plan.trust.map(r => ({ action: r.action, autoApproveAbove: r.autoApproveAbove, enabled: false, rung: r.rung, ...(r.risk ? { risk: r.risk } : {}) })),
    }));
  }
  return files;
}

/**
 * The lead of the first team — the workspace lead when it names none.
 * @param plan - The plan.
 */
export function planLead(plan: FunctionPlan): string | undefined {
  return plan.teams[0]?.lead;
}

/**
 * What a plan stands up, counted for the receipt — the same shape a template reports.
 * @param plan - The plan.
 * @param files - Its rendered files.
 */
export function planContents(plan: FunctionPlan, files: readonly TemplateFile[]) {
  return {
    teams: plan.teams.map(t => t.slug),
    agents: plan.agents.map(a => a.slug),
    missions: plan.missions.map(m => m.slug),
    automations: plan.automations.map(a => a.slug),
    skills: [...new Set(files.filter(f => f.path.startsWith('skills/')).map(f => f.path.split('/')[1]!))].sort(),
    trustRules: plan.trust.map(r => r.action),
    plugins: plan.reuse.plugins.map(p => p.slug),
    budgets: plan.agents.map(a => a.slug),
  };
}

/**
 * The rendered files held to the same schemas the workspace loader holds a
 * person's files to — so a plan that would not load is refused with the
 * loader's own words before anything is written.
 * @param files - A plan's rendered files.
 */
export function renderedProblems(files: readonly TemplateFile[]): string[] {
  const schemaFor = (path: string): z.ZodType | null => {
    if (path === 'trust.yaml') {
      return TrustManifestSchema;
    }
    if (!/\.ya?ml$/.test(path) || path.split('/').length !== 2) {
      return null;
    }
    return ({ teams: TeamManifestSchema, agents: AgentManifestSchema, missions: MissionManifestSchema, automations: AutomationManifestSchema } as Record<string, z.ZodType>)[path.split('/')[0]!] ?? null;
  };
  const problems: string[] = [];
  for (const file of files) {
    const schema = schemaFor(file.path);
    if (!schema) {
      continue;
    }
    const parsed = schema.safeParse(parseYaml(file.content));
    if (!parsed.success) {
      problems.push(...parsed.error.issues.map(i => `${file.path} ${i.path.join('.') || '(root)'}: ${i.message}`));
    }
  }
  return problems;
}
