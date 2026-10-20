import type { FlowStep, PageBlock } from '@/libs/workspace/pageFields';
import type { MonitorRow } from '@/services/workspace/monitors';
import { and, count, eq, gte, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { sourceNameOf } from '@/libs/sources/upsert';
import { actionRunSchema, agentSchema, artifactSchema, conversationSchema, knowledgeSourceSchema, playbookSchema } from '@/models/Schema';
import { listTeams } from '@/services/TeamService';
import { loadMonitors } from '@/services/workspace/monitors';
import { monthStart, prettySlug } from './teamFlowFormat';

/**
 * THE TEAM AND THE MONTH, AS A PERSON SEES THEM — the reads behind a page's
 * `team` and `flow` blocks (`libs/workspace/pageFields.ts`).
 *
 * Chris, 2026-10-20, of the Finance demo video: "the intro looks like slides —
 * those concepts (agent teams, workflows) should be visual in-platform". So a
 * team is read from its own rows (team, agent, the skills and sources each
 * agent names) and what each agent did this month is counted from what it
 * left behind (its conversations, the documents made in them, the proposals it
 * filed and how many a person let through). Nothing here is authored copy.
 */

export type TeamMemberView = {
  slug: string;
  name: string;
  eyebrow: string | null;
  owns: string | null;
  lead: boolean;
  skills: string[];
  systems: string[];
  month: MonthCounts;
};

export type MonthCounts = { conversations: number; documents: number; proposals: number; approved: number };

export type TeamBlockView = {
  name: string;
  goal: string | null;
  accountable: string | null;
  lead: TeamMemberView | null;
  members: TeamMemberView[];
  monthLabel: string;
};

export type FlowStepView = FlowStep & {
  agentName: string | null;
  monitor: MonitorRow | null;
  produced: Array<{ id: number; title: string }>;
};

const APPROVED = ['done', 'approved', 'executed'];

/**
 * Each agent's month, counted from what it left behind.
 * @param orgId - The workspace.
 * @param slugs - The agents.
 * @param since - The month's first instant.
 */
async function monthCounts(orgId: string, slugs: string[], since: Date): Promise<Map<string, MonthCounts>> {
  const out = new Map<string, MonthCounts>(slugs.map(s => [s, { conversations: 0, documents: 0, proposals: 0, approved: 0 }]));
  if (slugs.length === 0) {
    return out;
  }
  const proposer = sql<string>`${actionRunSchema.proposal}->>'agentSlug'`;
  const [convs, docs, props] = await Promise.all([
    db.select({ slug: conversationSchema.agentSlug, n: count() })
      .from(conversationSchema)
      .where(and(eq(conversationSchema.orgId, orgId), inArray(conversationSchema.agentSlug, slugs), gte(conversationSchema.createdAt, since)))
      .groupBy(conversationSchema.agentSlug),
    db.select({ slug: conversationSchema.agentSlug, n: count() })
      .from(artifactSchema)
      .innerJoin(conversationSchema, eq(artifactSchema.conversationId, conversationSchema.id))
      .where(and(
        eq(artifactSchema.orgId, orgId),
        inArray(conversationSchema.agentSlug, slugs),
        gte(artifactSchema.createdAt, since),
        eq(artifactSchema.visibility, 'user'),
        ne(artifactSchema.kind, 'file'),
      ))
      .groupBy(conversationSchema.agentSlug),
    db.select({ slug: proposer, status: actionRunSchema.status, n: count() })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.orgId, orgId), isNotNull(actionRunSchema.proposal), gte(actionRunSchema.createdAt, since), inArray(proposer, slugs)))
      .groupBy(proposer, actionRunSchema.status),
  ]);
  for (const r of convs) {
    out.get(r.slug)!.conversations = Number(r.n);
  }
  for (const r of docs) {
    out.get(r.slug)!.documents = Number(r.n);
  }
  for (const r of props) {
    const row = out.get(r.slug);
    if (!row) {
      continue;
    }
    row.proposals += Number(r.n);
    if (APPROVED.includes(r.status)) {
      row.approved += Number(r.n);
    }
  }
  return out;
}

/**
 * A `team` block's team: lead, members, the person accountable, and each
 * agent's skills, systems and month.
 * @param orgId - The workspace.
 * @param block - The block: `team` names which (absent, the first team), `agents` who is drawn, `systems` what sources read as.
 * @param now - The clock.
 * @param timeZone - The workspace's zone.
 */
export async function loadTeamBlock(orgId: string, block: Pick<PageBlock, 'team' | 'systems' | 'agents'>, now: Date, timeZone: string): Promise<TeamBlockView | null> {
  const teams = await listTeams(orgId);
  const team = (block.team ? teams.find(t => t.slug === block.team) : teams[0]) ?? null;
  if (!team) {
    return null;
  }
  // `agents` picks and orders who is drawn; the lead is drawn whenever it is a member.
  const slugs = block.agents
    ? [...new Set([...(team.leadAgentSlug ? [team.leadAgentSlug] : []), ...block.agents])].filter(s => team.members.some(m => m.slug === s))
    : team.members.map(m => m.slug);
  const { start, label } = monthStart(now, timeZone);
  const [agents, counts] = await Promise.all([
    slugs.length
      ? db.select({
          slug: agentSchema.slug,
          eyebrow: agentSchema.eyebrow,
          description: agentSchema.description,
          skills: agentSchema.skillSlugs,
          sources: agentSchema.connectorSources,
          active: agentSchema.active,
        }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), inArray(agentSchema.slug, slugs)))
      : Promise.resolve([]),
    monthCounts(orgId, slugs, start),
  ]);
  const skillSlugs = [...new Set(agents.flatMap(a => a.skills ?? []))];
  const sourceSlugs = [...new Set(agents.flatMap(a => a.sources ?? []))];
  const [skills, sources] = await Promise.all([
    skillSlugs.length
      ? db.select({ slug: playbookSchema.slug, name: playbookSchema.name }).from(playbookSchema).where(and(eq(playbookSchema.orgId, orgId), inArray(playbookSchema.slug, skillSlugs)))
      : Promise.resolve([]),
    sourceSlugs.length
      ? db.select({ slug: knowledgeSourceSchema.slug, config: knowledgeSourceSchema.configJson }).from(knowledgeSourceSchema).where(and(eq(knowledgeSourceSchema.orgId, orgId), inArray(knowledgeSourceSchema.slug, sourceSlugs)))
      : Promise.resolve([]),
  ]);
  const skillName = new Map(skills.map(s => [s.slug, s.name]));
  const sourceName = (slug: string): string => {
    const named = block.systems?.[slug];
    if (named) {
      return named;
    }
    const row = sources.find(s => s.slug === slug);
    const declared = row ? sourceNameOf(row.config, slug) : slug;
    return declared === slug ? prettySlug(slug) : declared;
  };
  const view = (slug: string): TeamMemberView | null => {
    const m = team.members.find(x => x.slug === slug);
    const a = agents.find(x => x.slug === slug);
    if (!m || !a || a.active === 'false') {
      return null;
    }
    return {
      slug,
      name: m.name,
      eyebrow: a.eyebrow,
      owns: a.description ?? m.description,
      lead: slug === team.leadAgentSlug,
      skills: (a.skills ?? []).map(s => skillName.get(s) ?? prettySlug(s)),
      // A system several sources reach (two QuickBooks companies) reads once.
      systems: [...new Set((a.sources ?? []).filter(s => !block.systems || block.systems[s] !== '').map(sourceName))],
      month: counts.get(slug)!,
    };
  };
  const lead = team.leadAgentSlug ? view(team.leadAgentSlug) : null;
  const members = slugs.filter(s => s !== team.leadAgentSlug).map(view).filter((x): x is TeamMemberView => x !== null);
  return {
    name: team.name,
    goal: team.description,
    accountable: team.accountable ? (team.accountable.name ?? team.accountable.email) : null,
    lead,
    members,
    monthLabel: label,
  };
}

/**
 * A `flow` block's steps, each with its agent's name, its automation's
 * cadence and last run, and the titles of what it produced.
 * @param orgId - The workspace.
 * @param steps - The steps, as authored.
 * @param now - The clock.
 */
export async function loadFlowBlock(orgId: string, steps: FlowStep[], now: Date): Promise<FlowStepView[]> {
  const agentSlugs = [...new Set(steps.map(s => s.agent).filter((s): s is string => Boolean(s)))];
  const automationSlugs = [...new Set(steps.map(s => s.automation).filter((s): s is string => Boolean(s)))];
  const artifactIds = [...new Set(steps.flatMap(s => s.artifacts ?? []))];
  const [agents, monitors, artifacts] = await Promise.all([
    agentSlugs.length
      ? db.select({ slug: agentSchema.slug, name: agentSchema.name }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), inArray(agentSchema.slug, agentSlugs)))
      : Promise.resolve([]),
    automationSlugs.length ? loadMonitors(orgId, automationSlugs, now) : Promise.resolve([]),
    artifactIds.length
      ? db.select({ id: artifactSchema.id, title: artifactSchema.title }).from(artifactSchema).where(and(eq(artifactSchema.orgId, orgId), inArray(artifactSchema.id, artifactIds)))
      : Promise.resolve([]),
  ]);
  return steps.map(s => ({
    ...s,
    agentName: s.agent ? (agents.find(a => a.slug === s.agent)?.name ?? null) : null,
    monitor: s.automation ? (monitors.find(m => m.slug === s.automation) ?? null) : null,
    // In the order authored; an id this workspace does not hold is left out.
    produced: (s.artifacts ?? []).map(id => artifacts.find(a => a.id === id)).filter((a): a is { id: number; title: string } => Boolean(a)),
  }));
}
