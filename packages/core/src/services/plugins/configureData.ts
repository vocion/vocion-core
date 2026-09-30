import type {
  ConfigureAutomationInput,
  ConfigureChangeInput,
  ConfigureInput,
  ConfigureLearningInput,
  ConfigureMeasureInput,
  ConfigureSeatInput,
  ConfigureSkillInput,
  ConfigureTrustInput,
} from '@/features/dashboard/configure/configurePlan';
import type { TeamMeasure } from '@/models/Schema';
import type { EffectivePolicy } from '@/services/autonomy/AutonomyService';
import type { MeasureReading } from '@/services/team-report';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, desc, eq, inArray, isNotNull, max, notInArray, or, sql } from 'drizzle-orm';
import { parse as parseYaml } from 'yaml';
import { cronToText } from '@/features/dashboard/TriggerBadge';
import { actionForPolicyKey } from '@/libs/actions/policyKey';
import { db } from '@/libs/DB';
import { skillBodySha } from '@/libs/workspace/loader';
import { loadPlugin, pluginContents, readPluginTeams } from '@/libs/workspace/plugins';
import { TrustManifestSchema } from '@/libs/workspace/schemas';
import { effectiveMeasures } from '@/libs/workspace/team-export';
import {
  agentSchema,
  automationRunSchema,
  automationSchema,
  missionRunSchema,
  missionSchema,
  playbookSchema,
  teamSchema,
  toolCallSchema,
  workerRunSchema,
  workspaceVersionSchema,
} from '@/models/Schema';
import { CONTROL_RUN_KIND, SKIPPED_RUN_KIND, userNamesById } from '@/services/AutomationService';
import { effectivePolicies } from '@/services/autonomy/AutonomyService';
import { isRung, RUNG_LABEL, rungAutomates, rungFromTrustRule } from '@/services/autonomy/rungs';
import { agentBudgetStatuses } from '@/services/BudgetService';
import { readPluginLearnings } from '@/services/plugins/pluginReads';
import { readTeamMeasures } from '@/services/team-report';

/**
 * Everything the Configure page reads, for one plugin — its agents as seats,
 * its skills and playbooks against the workspace's overrides, its
 * automations with their newest fire, its trust ladder as this workspace
 * stands on it, what its agents learned, its team's measures, and the recent
 * changes to all of that.
 *
 * Every read is one core already owns; this module only scopes them to what
 * the plugin's own directory declares (`pluginContents`, its `trust.yaml`, its
 * teams), so the page is the same for any plugin and names none of them. The
 * view model is `features/dashboard/configure/configurePlan.ts`.
 */

/** How many learnings the Learned tab lists. */
const LEARNINGS_SHOWN = 25;

/** How far back each source of changes is read, per source. */
const CHANGES_PER_SOURCE = 8;

function humanize(slug: string): string {
  const spaced = slug.replace(/[-_]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The plugin's trust rules, as its `trust.yaml` ships them. Empty when it
 * ships none, or the file does not parse (the apply already refused it).
 * @param sourcePath - The plugin's directory.
 */
function readPluginTrust(sourcePath: string): Array<{ action: string; enabled: boolean; autoApproveAbove: number; rung?: string; risk?: string }> {
  const file = join(sourcePath, 'trust.yaml');
  if (!existsSync(file)) {
    return [];
  }
  const parsed = TrustManifestSchema.safeParse(parseYaml(readFileSync(file, 'utf8')));
  return parsed.success ? parsed.data.rules : [];
}

/**
 * The trigger in words: "Every hour (UTC)", "On object.created".
 * @param when - `automation.when_config`.
 * @param when.schedule - Its cron, for a schedule.
 * @param when.event - The event type or types, for an event.
 */
function triggerLine(when: { schedule?: string; event?: string | string[] }): string {
  if (when.schedule) {
    return cronToText(when.schedule);
  }
  const events = Array.isArray(when.event) ? when.event : when.event ? [when.event] : [];
  return events.length > 0 ? `On ${events.join(', ')}` : 'By hand';
}

/**
 * What an automation does, when its author wrote no description: its target.
 * @param doConfig - `automation.do_config`.
 * @param doConfig.workflow - A workflow it runs.
 * @param doConfig.checkMission - A mission it checks.
 * @param doConfig.job - A built-in job it runs.
 */
function doesLine(doConfig: { workflow?: string; checkMission?: string; job?: string }): string {
  if (doConfig.checkMission) {
    return `Checks ${humanize(doConfig.checkMission).toLowerCase()}`;
  }
  if (doConfig.workflow) {
    return `Runs ${humanize(doConfig.workflow).toLowerCase()}`;
  }
  if (doConfig.job) {
    return `Runs ${humanize(doConfig.job).toLowerCase()}`;
  }
  return '';
}

/**
 * The first sentence of an author's description, which is what a row has room for.
 * @param text - The automation's `description`.
 */
function firstSentence(text: string | null): string | null {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) {
    return null;
  }
  const end = clean.search(/[.!?](\s|$)/);
  return end > 0 ? clean.slice(0, end + 1) : clean;
}

/**
 * Read the Configure page's inputs for one plugin.
 * @param orgId - The project.
 * @param pluginSlug - The plugin whose page this is.
 * @param now - One instant for the whole page.
 */
export async function loadConfigure(orgId: string, pluginSlug: string, now: Date = new Date()): Promise<ConfigureInput> {
  const plugin = loadPlugin(pluginSlug);
  const contents = pluginContents(plugin);
  const manifestTeams = readPluginTeams(plugin);
  const trustRules = readPluginTrust(plugin.sourcePath);
  const agentSlugs = contents.agents;
  const folderSlugs = [...contents.skills, ...contents.playbooks];

  const [agentRows, missionRows, playbookRows, automationRows, teamRows, policies, budgets, learnings] = await Promise.all([
    agentSlugs.length > 0
      ? db.select({
          slug: agentSchema.slug,
          name: agentSchema.name,
          eyebrow: agentSchema.eyebrow,
          role: agentSchema.role,
          model: agentSchema.model,
          harnessConfig: agentSchema.harnessConfig,
        }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), inArray(agentSchema.slug, agentSlugs)))
      : Promise.resolve([]),
    agentSlugs.length > 0
      ? db.select({ name: missionSchema.name, agentSlug: missionSchema.agentSlug }).from(missionSchema).where(and(eq(missionSchema.orgId, orgId), inArray(missionSchema.agentSlug, agentSlugs)))
      : Promise.resolve([]),
    folderSlugs.length > 0
      ? db.select({
          slug: playbookSchema.slug,
          name: playbookSchema.name,
          kind: playbookSchema.kind,
          origin: playbookSchema.origin,
          frontmatter: playbookSchema.frontmatter,
          updatedAt: playbookSchema.updatedAt,
        }).from(playbookSchema).where(and(eq(playbookSchema.orgId, orgId), inArray(playbookSchema.slug, folderSlugs)))
      : Promise.resolve([]),
    contents.automations.length > 0
      ? db.select().from(automationSchema).where(and(eq(automationSchema.orgId, orgId), inArray(automationSchema.slug, contents.automations)))
      : Promise.resolve([]),
    manifestTeams.length > 0
      ? db.select({ slug: teamSchema.slug, name: teamSchema.name, measures: teamSchema.measures, kpis: teamSchema.kpis })
          .from(teamSchema)
          .where(and(eq(teamSchema.orgId, orgId), inArray(teamSchema.slug, manifestTeams.map(t => t.slug))))
      : Promise.resolve([]),
    effectivePolicies(orgId),
    agentBudgetStatuses(orgId),
    readPluginLearnings(orgId, agentSlugs, LEARNINGS_SHOWN),
  ]);

  const [lastRuns, lastFires, controls, applies] = await Promise.all([
    readLastRuns(orgId, agentSlugs),
    readLastFires(orgId, contents.automations),
    contents.automations.length > 0
      ? db.select({ id: automationRunSchema.id, slug: automationRunSchema.slug, result: automationRunSchema.result, startedAt: automationRunSchema.startedAt })
          .from(automationRunSchema)
          .where(and(eq(automationRunSchema.orgId, orgId), eq(automationRunSchema.kind, CONTROL_RUN_KIND), inArray(automationRunSchema.slug, contents.automations)))
          .orderBy(desc(automationRunSchema.startedAt))
          .limit(CHANGES_PER_SOURCE)
      : Promise.resolve([]),
    db.select({ id: workspaceVersionSchema.id, summary: workspaceVersionSchema.summary, appliedBy: workspaceVersionSchema.appliedBy, appliedAt: workspaceVersionSchema.appliedAt })
      .from(workspaceVersionSchema)
      .where(and(eq(workspaceVersionSchema.orgId, orgId), eq(workspaceVersionSchema.status, 'applied')))
      .orderBy(desc(workspaceVersionSchema.appliedAt))
      .limit(CHANGES_PER_SOURCE),
  ]);

  // ---- seats ----
  const ownsBy = new Map<string, string[]>();
  for (const m of missionRows) {
    ownsBy.set(m.agentSlug, [...(ownsBy.get(m.agentSlug) ?? []), m.name]);
  }
  const budgetBy = new Map(budgets.agents.map(b => [b.agentSlug, b]));
  const agentBy = new Map(agentRows.map(a => [a.slug, a]));
  const seats: ConfigureSeatInput[] = agentSlugs.map((slug) => {
    const row = agentBy.get(slug);
    const budget = budgetBy.get(slug);
    return {
      slug,
      name: row?.name ?? humanize(slug),
      seat: row?.eyebrow ?? null,
      role: row?.role ?? 'specialist',
      model: row?.harnessConfig?.model ?? row?.model ?? null,
      owns: ownsBy.get(slug) ?? [],
      lastRunAt: lastRuns.get(slug) ?? null,
      overBudget: budget?.blocked ? { spentCents: budget.spentCents, limitCents: budget.hardCentsLimit } : null,
    };
  });

  // ---- skills & playbooks ----
  const playbookBy = new Map(playbookRows.map(p => [p.slug, p]));
  const folder = (kind: 'skill' | 'playbook', slug: string): ConfigureSkillInput => {
    const row = playbookBy.get(slug);
    const override = row?.origin === 'override';
    const baseSha = (row?.frontmatter as { baseSha?: unknown } | undefined)?.baseSha;
    const shipped = override && typeof baseSha === 'string'
      ? skillBodySha(join(plugin.sourcePath, kind === 'skill' ? 'skills' : 'playbooks', slug, 'SKILL.md'))
      : null;
    return {
      slug,
      name: row?.name ?? humanize(slug),
      kind,
      source: !row ? 'missing' : override ? 'override' : 'plugin',
      updatedAt: row?.updatedAt ?? null,
      drifted: shipped !== null && shipped !== baseSha,
    };
  };
  const skills: ConfigureSkillInput[] = [
    ...contents.skills.map(slug => folder('skill', slug)),
    ...contents.playbooks.map(slug => folder('playbook', slug)),
  ];

  // ---- automations ----
  const automationBy = new Map(automationRows.map(a => [a.slug, a]));
  const pauserIds = automationRows.map(a => a.pausedBy).filter((id): id is string => !!id);
  const automations: ConfigureAutomationInput[] = contents.automations.map((slug) => {
    const row = automationBy.get(slug);
    const fire = lastFires.get(slug) ?? null;
    return {
      slug,
      name: row?.name ?? humanize(slug),
      trigger: row ? triggerLine(row.whenConfig) : '',
      does: firstSentence(row?.description ?? null) ?? (row ? doesLine(row.doConfig) : ''),
      disabled: row?.status === 'disabled',
      paused: row?.pausedAt ? { by: row.pausedBy, at: row.pausedAt, note: row.pausedNote } : null,
      last: fire,
    };
  });

  // ---- trust ----
  const pluginActions = trustRules.map(r => r.action);
  const trust: ConfigureTrustInput[] = [];
  for (const rule of trustRules) {
    trust.push(trustRow(rule.action, null, policies.get(rule.action) ?? null, rule));
    // A derived key the workspace wrote for this action (`git.merge.docs`)
    // is a rung of its own and reads beside the rule it refines.
    for (const [key, policy] of policies) {
      if (key.startsWith(`${rule.action}.`) && !pluginActions.includes(key)) {
        trust.push(trustRow(key, rule.action, policy, null));
      }
    }
  }

  // ---- measures ----
  const teams = manifestTeams.map((t) => {
    const row = teamRows.find(r => r.slug === t.slug);
    return { slug: t.slug, name: row?.name ?? t.name, measures: row ? effectiveMeasures(row) : (t.measures as TeamMeasure[]) };
  });
  const readings = teams.length > 0
    ? await readTeamMeasures(orgId, teams.map(t => ({ teamSlug: t.slug, agentSlugs, measures: t.measures })), now)
    : new Map<string, MeasureReading>();
  const measures: ConfigureMeasureInput[] = teams.flatMap(t => t.measures.flatMap((m) => {
    const reading = readings.get(`${t.slug}/${m.key}`);
    if (!reading) {
      return [];
    }
    return [{
      id: `${t.slug}/${m.key}`,
      label: m.label,
      teamName: t.name,
      unit: m.unit,
      target: m.target,
      direction: m.direction,
      window: m.window,
      value: reading.value,
      previous: reading.previous,
      improving: reading.improving,
      sourceLabel: reading.sourceLabel,
    }];
  }));

  // ---- changes ----
  // A rung the apply wrote from the plugin's own file is part of that apply,
  // which is already a change; what is listed is a person's move, or
  // Vocion's own demotion.
  const policyChanges = [...policies.values()].filter(p => p.policy?.promotedAt && p.policy.source !== 'trust.yaml' && (pluginActions.includes(p.actionId) || pluginActions.some(a => p.actionId.startsWith(`${a}.`))));
  const userIds = [
    ...pauserIds,
    ...learnings.map(l => l.by).filter((id): id is string => !!id),
    ...policyChanges.map(p => p.policy!.promotedBy).filter((id): id is string => !!id && id !== 'system'),
    ...applies.map(a => a.appliedBy).filter((id): id is string => !!id && id !== 'system'),
  ];
  const names = await userNamesById(userIds);
  const who = (id: string | null | undefined): string | null => (!id ? null : id === 'system' ? 'Vocion' : names.get(id) ?? null);

  const changes: ConfigureChangeInput[] = [];
  for (const c of controls) {
    const result = (c.result ?? {}) as { action?: string; by?: { id?: string; name?: string | null } };
    const name = automationBy.get(c.slug)?.name ?? humanize(c.slug);
    changes.push({ id: `control:${c.id}`, what: `${result.action === 'resume' ? 'Resumed' : 'Paused'} ${name}`, who: result.by?.name ?? who(result.by?.id), at: c.startedAt, href: `/dashboard/automation/${c.slug}` });
  }
  for (const p of policyChanges) {
    const rung = isRung(p.policy!.rung) ? RUNG_LABEL[p.policy!.rung] : p.policy!.rung;
    changes.push({ id: `policy:${p.actionId}`, what: `${policyName(p.actionId)} → ${rung}`, who: who(p.policy!.promotedBy), at: p.policy!.promotedAt!, href: '/dashboard/autonomy' });
  }
  for (const l of learnings) {
    if ((l.status === 'adopted' || l.status === 'approved' || l.status === 'rejected') && l.at) {
      const text = l.text.replace(/\s+/g, ' ').trim();
      changes.push({ id: `learning:${l.id}`, what: `${l.status === 'rejected' ? 'Rejected' : 'Adopted'} “${text.length > 60 ? `${text.slice(0, 60).trimEnd()}…` : text}”`, who: who(l.by), at: l.at, href: '/dashboard/learnings' });
    }
  }
  for (const a of applies) {
    const changed = Object.values(a.summary ?? {}).reduce((n, counts) => n + (counts.created ?? 0) + (counts.updated ?? 0), 0);
    if (changed > 0) {
      changes.push({ id: `apply:${a.id}`, what: `Workspace applied · ${changed} ${changed === 1 ? 'change' : 'changes'}`, who: who(a.appliedBy), at: a.appliedAt, href: '/dashboard/workspace' });
    }
  }

  // Pausers are named on the row, not by id.
  for (const a of automations) {
    if (a.paused?.by) {
      a.paused.by = names.get(a.paused.by) ?? null;
    }
  }

  const learned: ConfigureLearningInput[] = learnings.map(l => ({ id: l.id, text: l.text, status: l.status, at: l.at, step: l.step, origin: l.origin ?? null }));

  return { pluginName: plugin.manifest.name, seats, skills, automations, trust, learnings: learned, measures, changes };
}

/**
 * A policy key in words: the action's name, and the class a derived key
 * narrows it to ("Merge a branch · docs").
 * @param key - The policy key.
 */
function policyName(key: string): string {
  const action = actionForPolicyKey(key);
  if (!action) {
    return key;
  }
  return action.id === key ? action.name : `${action.name} · ${key.slice(action.id.length + 1)}`;
}

/**
 * One rung, as this workspace stands on it. A key nobody has a row for reads
 * the plugin's rule as the apply would have written it.
 * @param key - The policy key.
 * @param parent - The plugin action a derived key refines.
 * @param policy - The effective policy, when the org has a row or a rule.
 * @param rule - The plugin's rule for this key, when it ships one.
 */
function trustRow(
  key: string,
  parent: string | null,
  policy: EffectivePolicy | null,
  rule: { enabled: boolean; autoApproveAbove: number; rung?: string; risk?: string } | null,
): ConfigureTrustInput {
  const rung = policy?.rung ?? (rule?.rung && isRung(rule.rung) ? rule.rung : rungFromTrustRule(rule ? { enabled: rule.enabled } : null));
  return {
    key,
    // A class the plugin or the workspace narrowed an action to reads as its
    // own rung: "Start the build · retry", never four "Start the build"s.
    name: policyName(key),
    parent,
    runsOnItsOwn: rungAutomates(rung),
    rungLabel: RUNG_LABEL[rung],
    minConfidence: policy?.minConfidence ?? rule?.autoApproveAbove ?? 1,
    risk: policy?.riskTier ?? rule?.risk ?? 'medium',
    flagged: policy?.policy?.flagged ?? false,
  };
}

/**
 * The newest thing each agent did: a tool call it made, a worker run it
 * held, or a mission run it led — whichever is latest.
 * @param orgId - The project.
 * @param agentSlugs - The seats.
 */
async function readLastRuns(orgId: string, agentSlugs: readonly string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (agentSlugs.length === 0) {
    return out;
  }
  const lead = sql<string>`${missionRunSchema.team}->>'lead'`;
  const [calls, workers, missions] = await Promise.all([
    db.select({ slug: toolCallSchema.agentSlug, at: max(toolCallSchema.createdAt) }).from(toolCallSchema).where(and(eq(toolCallSchema.orgId, orgId), inArray(toolCallSchema.agentSlug, [...agentSlugs]))).groupBy(toolCallSchema.agentSlug),
    db.select({ slug: workerRunSchema.agentSlug, at: max(workerRunSchema.createdAt) }).from(workerRunSchema).where(and(eq(workerRunSchema.orgId, orgId), inArray(workerRunSchema.agentSlug, [...agentSlugs]))).groupBy(workerRunSchema.agentSlug),
    db.select({ slug: lead, at: max(missionRunSchema.createdAt) }).from(missionRunSchema).where(and(eq(missionRunSchema.orgId, orgId), inArray(lead, [...agentSlugs]))).groupBy(lead),
  ]);
  for (const r of [...calls, ...workers, ...missions]) {
    if (!r.slug || !r.at) {
      continue;
    }
    const at = r.at instanceof Date ? r.at : new Date(r.at);
    const prior = out.get(r.slug);
    if (!prior || at > prior) {
      out.set(r.slug, at);
    }
  }
  return out;
}

/**
 * Each automation's newest fire, in one query. A person's pause or resume is
 * not a fire, and neither is a match the guards refused on purpose; a match
 * that could not START is — it is an error row with its reason, and the one
 * a person most needs to see (EventService, `fire_failed`).
 * @param orgId - The project.
 * @param slugs - The plugin's automations.
 */
async function readLastFires(orgId: string, slugs: readonly string[]): Promise<Map<string, NonNullable<ConfigureAutomationInput['last']>>> {
  const out = new Map<string, NonNullable<ConfigureAutomationInput['last']>>();
  if (slugs.length === 0) {
    return out;
  }
  const rows = await db
    .selectDistinctOn([automationRunSchema.slug], {
      slug: automationRunSchema.slug,
      kind: automationRunSchema.kind,
      status: automationRunSchema.status,
      error: automationRunSchema.error,
      startedAt: automationRunSchema.startedAt,
    })
    .from(automationRunSchema)
    .where(and(
      eq(automationRunSchema.orgId, orgId),
      inArray(automationRunSchema.slug, [...slugs]),
      or(
        notInArray(automationRunSchema.kind, [CONTROL_RUN_KIND, SKIPPED_RUN_KIND]),
        and(eq(automationRunSchema.kind, SKIPPED_RUN_KIND), eq(automationRunSchema.status, 'error'), isNotNull(automationRunSchema.error)),
      ),
    ))
    .orderBy(automationRunSchema.slug, desc(automationRunSchema.startedAt), desc(automationRunSchema.id));
  for (const r of rows) {
    const status = r.status === 'error' ? 'error' : r.status === 'running' ? 'running' : 'ok';
    out.set(r.slug, { at: r.startedAt, status, error: r.error, failedToStart: r.kind === SKIPPED_RUN_KIND });
  }
  return out;
}
