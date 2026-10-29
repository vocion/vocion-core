/**
 * A CLIENT'S SEO STRATEGY — one goal a person owns, measured by milestones
 * linked to the work that completes them, and the document that explains it.
 *
 * The agency lead asked for "structured planning and execution for each
 * client's SEO strategy". Vocion already has the noun: a Goal
 * (docs/guides/goals.md) with an owner, a horizon and a measure, drafted as
 * a Decision card (`goal.create`). A strategy is that goal for a client
 * ("Tally Books named in AI answers for agency invoicing in Q1 2027"), with
 * 3–7 milestones each linked to a record whose own status completes it:
 *
 *   an audit     "Fix the audit's high findings" — done when the audit has
 *                no open high finding (its row reads `resolved`)
 *   a batch      "Publish <batch>" — done when every page of it is live
 *                (`published`)
 *   a prompt     "Named in AI answers for <prompt>" — done when an answer
 *                names or cites the client (`complete`)
 *
 * `seo_draft_strategy` composes the draft from the client's profile, latest
 * audit, batches and prompts, writes the strategy document on the project and
 * puts the goal card in front of the person. The `seo_strategy` record is the
 * Strategy page's row: the goal, how far along it is, and the document,
 * refreshed whenever the SEO work moves (`refreshStrategy`).
 */

import type { SeoProfile } from './profile';
import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { businessObjectSchema } from '@/models/Schema';
import { getObjectTypeBySlug } from '@/services/BusinessObjectService';
import { CLIENT_TYPE_LABEL, GOAL_LABEL, playbookLinks, seoPriorities } from './profile';
import { mergeMeta } from './records';

export const SEO_STRATEGY_TYPE = 'seo_strategy';
export const STRATEGY_EXTERNAL_SYSTEM = 'seo-strategy';

/** A row status the goal milestones read as finished (`GoalService` FINISHED). */
export const DONE_STATUS = { audit: 'resolved', batch: 'published', prompt: 'complete' } as const;

/**
 * Set a record's row status when it differs. The status is what a goal
 * milestone linked to the record reads: a finished one completes it.
 * @param orgId - The workspace.
 * @param id - The record.
 * @param status - The status.
 */
export async function setRowStatus(orgId: string, id: number, status: string): Promise<void> {
  await db.update(businessObjectSchema).set({ status }).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id), ne(businessObjectSchema.status, status)));
}

/** What the draft is composed from. */
export type StrategyInputs = {
  client: string;
  profile?: SeoProfile;
  topic?: string;
  /** The goal's horizon as a person reads it ("in Q1 2027"). */
  horizonText: string;
  audit?: { id: number; title: string; highCount: number; openCount: number; checkedAt: string; reportArtifactId?: number; nextSteps: string[] } | null;
  batches: Array<{ id: number; title: string; total: number; published: number; status?: string }>;
  prompts: Array<{ id: number; prompt: string; group?: string; visibility?: string }>;
  keywords?: { total: number; ideas: number; ranking: number };
};

/**
 * The goal's title, from what the client wants first. Pure.
 * @param i - The inputs.
 */
export function strategyTitle(i: Pick<StrategyInputs, 'client' | 'profile' | 'topic' | 'horizonText'>): string {
  const topic = i.topic?.trim() || i.profile?.offering?.split(/[.,;]/)[0]?.trim().toLowerCase() || i.profile?.industry?.toLowerCase() || 'its category';
  const where = i.profile?.locations?.[0] ? ` in ${i.profile.locations[0].split(',')[0]}` : '';
  const first = i.profile?.goals?.[0];
  const what = first === 'ai_answers'
    ? `named in AI answers for ${topic}`
    : first === 'google_business_profile'
      ? `in Google's local results for ${topic}${where}`
      : first === 'rankings'
        ? `ranking on Google for ${topic}`
        : `winning leads from search for ${topic}${i.profile?.clientType === 'local_services' ? where : ''}`;
  return `${i.client} ${what} ${i.horizonText}`.replace(/\s+/g, ' ').trim();
}

export type DraftMilestone = { label: string; link?: { kind: 'record'; id: string; label?: string } };

/**
 * The milestones, 3 to 7, each linked to the record whose own status
 * completes it where there is one: the latest audit's high findings, the
 * batches not yet live, the prompts the client is not named for; and the
 * work still to start where there is none. Ordered as the client's goals
 * rank the work. Pure.
 * @param i - The inputs.
 */
export function strategyMilestones(i: StrategyInputs): DraftMilestone[] {
  const out: DraftMilestone[] = [];
  const pr = seoPriorities(i.profile);
  if (!i.audit) {
    out.push({ label: 'Audit the site and fix what it finds first' });
  } else if (i.audit.highCount > 0) {
    out.push({ label: `Fix the audit's ${i.audit.highCount} high ${i.audit.highCount === 1 ? 'finding' : 'findings'}`, link: { kind: 'record', id: String(i.audit.id), label: i.audit.title } });
  }
  const notNamed = i.prompts.filter(p => p.visibility !== 'mentioned' && p.visibility !== 'cited');
  const promptMilestones: DraftMilestone[] = pr.trackPrompts
    ? (i.prompts.length === 0
        ? [{ label: 'Track the questions buyers ask AI assistants' }]
        : notNamed.slice(0, 2).map(p => ({ label: `Named in AI answers for "${p.prompt}"`, link: { kind: 'record' as const, id: String(p.id), label: p.prompt } })))
    : [];
  const batchMilestones: DraftMilestone[] = i.batches.filter(b => b.total > 0 && b.published < b.total).slice(0, 3).map(b => ({ label: `Publish "${b.title}" (${b.published} of ${b.total} live)`, link: { kind: 'record', id: String(b.id), label: b.title } }));
  if (batchMilestones.length === 0) {
    batchMilestones.push({ label: (i.keywords?.ideas ?? 0) > 0 ? 'Plan and publish a batch from the Keywords register' : `Plan and publish the first ${pr.pageTypes[0] ?? 'service'} pages` });
  }
  // AI answers first when it is the first goal; pages first otherwise.
  const aiFirst = i.profile?.goals?.[0] === 'ai_answers';
  out.push(...(aiFirst ? [...promptMilestones, ...batchMilestones] : [...batchMilestones, ...promptMilestones]));
  if ((i.profile?.goals ?? []).includes('google_business_profile')) {
    out.push({ label: 'Google Business Profile current: categories, services, photos and weekly posts' });
  }
  if (out.length < 3) {
    out.push({ label: 'Audit the site again and confirm the fixes held' });
  }
  if (out.length < 3) {
    out.push({ label: 'Report results to the client' });
  }
  return out.slice(0, 7);
}

/**
 * The strategy document: the goal, why (the profile and what comes first),
 * where the client stands (latest audit, keywords, prompts, batches), and the
 * milestones with what each is linked to. Pure.
 * @param i - The inputs.
 * @param a - The goal's title, milestones and the project.
 * @param a.title
 * @param a.milestones
 * @param a.projectId
 * @param a.date
 */
export function renderStrategyDoc(i: StrategyInputs, a: { title: string; milestones: DraftMilestone[]; projectId: number; date: string }): string {
  const p = i.profile;
  const pr = seoPriorities(p);
  const out = [`# SEO strategy · ${i.client}`, '', `_Written ${a.date}. The goal is set when a person approves it; its milestones complete as the linked work does._`, '', `## The goal`, '', `**${a.title}**`, ''];
  out.push('## Who the client is', '');
  if (p) {
    out.push(`- ${[p.clientType ? CLIENT_TYPE_LABEL[p.clientType] : null, p.industry].filter(Boolean).join(' · ') || 'Client type not set'}`);
    if (p.goals?.length) {
      out.push(`- Goals, most important first: ${p.goals.map(g => GOAL_LABEL[g]).join(', ')}`);
    }
    if (p.offering) {
      out.push(`- Offering: ${p.offering}`);
    }
    if (p.audience) {
      out.push(`- Audience: ${p.audience}`);
    }
    if (p.locations?.length) {
      out.push(`- Serves: ${p.locations.join(', ')}`);
    }
  } else {
    out.push('- No SEO profile yet: the client type and goals are not set.');
  }
  out.push(`- [The project](/dashboard/projects/${a.projectId}): profile, instructions, wiki and guidelines`, '');
  if (pr.lines.length) {
    out.push('## What comes first', '', ...pr.lines.map((l, n) => `${n + 1}. ${l}`), '');
  }
  out.push(`Playbooks we lead with for this client: ${playbookLinks(pr.playbooks).map(l => `[${l.label}](${l.href})`).join(', ')}.`, '');
  out.push('## Where things stand', '');
  out.push(i.audit
    ? `- **Audit** ${i.audit.checkedAt.slice(0, 10)}: ${i.audit.openCount} open, ${i.audit.highCount} high · [${i.audit.title}](/dashboard/objects/${i.audit.id})${i.audit.reportArtifactId ? ` · [report](/dashboard/artifacts/${i.audit.reportArtifactId})` : ''}`
    : '- **Audit**: none yet.');
  out.push(i.keywords ? `- **Keywords**: ${i.keywords.total} researched, ${i.keywords.ideas} ideas, ${i.keywords.ranking} ranking · [Keywords](/dashboard/p/seo-keywords?project=${a.projectId})` : '- **Keywords**: none yet.');
  const named = i.prompts.filter(x => x.visibility === 'mentioned' || x.visibility === 'cited').length;
  out.push(i.prompts.length ? `- **AI prompts**: ${i.prompts.length} tracked, the client named on ${named} · [Prompts](/dashboard/p/seo-prompts?project=${a.projectId})` : '- **AI prompts**: none tracked.');
  out.push(i.batches.length ? `- **Batches**: ${i.batches.map(b => `${b.title} (${b.published} of ${b.total} live)`).join('; ')}` : '- **Batches**: none yet.', '');
  out.push('## Milestones', '');
  a.milestones.forEach((m, n) => out.push(`${n + 1}. ${m.label}${m.link ? ` — [${m.link.label ?? `record #${m.link.id}`}](/dashboard/objects/${m.link.id})` : ''}`));
  if (i.audit?.nextSteps.length) {
    out.push('', '## The audit\'s next steps', '', ...i.audit.nextSteps.map((s, n) => `${n + 1}. ${s}`));
  }
  return out.join('\n');
}

export type SeoStrategyMeta = {
  projectId: number;
  projectName: string;
  goalTitle: string;
  horizon: string;
  goalId?: number;
  /** drafted (the card waits), or the goal's own status. */
  goalStatus: string;
  progressLine: string;
  milestones: Array<{ label: string; done: boolean; href?: string }>;
  documentArtifactId?: number;
  updatedAt: string;
};

/**
 * The project's strategy row, made once (unique by project), its meta laid
 * over. Null when the `seo_strategy` type is not installed.
 * @param orgId - The workspace.
 * @param project - The project.
 * @param project.id
 * @param project.title
 * @param meta - What to write.
 * @param by - Who.
 */
export async function upsertStrategy(orgId: string, project: { id: number; title: string }, meta: Partial<SeoStrategyMeta>, by: string): Promise<number | null> {
  const type = await getObjectTypeBySlug(orgId, SEO_STRATEGY_TYPE);
  if (!type) {
    return null;
  }
  const externalId = String(project.id);
  const base: SeoStrategyMeta = { projectId: project.id, projectName: project.title, goalTitle: '', horizon: '', goalStatus: 'drafted', progressLine: '', milestones: [], updatedAt: new Date().toISOString() };
  const [inserted] = await db
    .insert(businessObjectSchema)
    .values({ orgId, typeId: type.id, title: `Strategy · ${project.title}`, status: 'active', metadata: { ...base, ...meta }, externalSystem: STRATEGY_EXTERNAL_SYSTEM, externalId, createdBy: by })
    .onConflictDoNothing({ target: [businessObjectSchema.orgId, businessObjectSchema.externalSystem, businessObjectSchema.externalId] })
    .returning({ id: businessObjectSchema.id, title: businessObjectSchema.title });
  if (inserted) {
    const { announceObjectCreated } = await import('@/services/objects/objectCreated');
    await announceObjectCreated(orgId, inserted, SEO_STRATEGY_TYPE, { source: 'service', actor: by });
    return inserted.id;
  }
  const [existing] = await db.select({ id: businessObjectSchema.id }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.externalSystem, STRATEGY_EXTERNAL_SYSTEM), eq(businessObjectSchema.externalId, externalId))).limit(1);
  await mergeMeta<SeoStrategyMeta>(orgId, existing!.id, () => ({ ...meta, updatedAt: new Date().toISOString() }));
  return existing!.id;
}

/**
 * The project's strategy row, or null.
 * @param orgId - The workspace.
 * @param projectId - The project.
 */
export async function getStrategy(orgId: string, projectId: number): Promise<{ id: number; meta: SeoStrategyMeta } | null> {
  const [row] = await db.select({ id: businessObjectSchema.id, metadata: businessObjectSchema.metadata }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.externalSystem, STRATEGY_EXTERNAL_SYSTEM), eq(businessObjectSchema.externalId, String(projectId)))).limit(1);
  return row ? { id: row.id, meta: row.metadata as SeoStrategyMeta } : null;
}

/**
 * Read the project's strategy goal now and write where it stands onto the
 * strategy row: the goal (found by its id, or by its link to the project and
 * its title once a person approved the card), its status, progress and each
 * milestone. Never throws; does nothing for a project with no strategy.
 * @param orgId - The workspace.
 * @param projectId - The project.
 */
export async function refreshStrategy(orgId: string, projectId: number): Promise<SeoStrategyMeta | null> {
  try {
    const row = await getStrategy(orgId, projectId);
    if (!row) {
      return null;
    }
    const { getGoal, listGoals, measureGoal } = await import('@/services/objectives/GoalService');
    let goal = row.meta.goalId ? await getGoal(orgId, row.meta.goalId) : null;
    if (!goal) {
      goal = (await listGoals({ orgId })).find(g => g.title === row.meta.goalTitle && g.links.some(l => l.kind === 'room' && l.id === String(projectId))) ?? null;
    }
    if (!goal) {
      return row.meta;
    }
    const { goal: measured, progress } = await measureGoal(goal);
    const milestones = measured.measure.kind === 'milestones'
      ? measured.measure.milestones.map(m => ({ label: m.label, done: m.done, ...(m.link?.kind === 'record' ? { href: `/dashboard/objects/${m.link.id}` } : {}) }))
      : row.meta.milestones;
    const written = await mergeMeta<SeoStrategyMeta>(orgId, row.id, () => ({ goalId: measured.id, goalStatus: measured.status, goalTitle: measured.title, progressLine: progress.label, milestones, updatedAt: new Date().toISOString() }));
    return written;
  } catch {
    return null;
  }
}

/**
 * A project's records of one SEO type, for the draft: id, title, row status and meta.
 * @param orgId - The workspace.
 * @param projectId - The project.
 * @param slug - The type.
 */
export async function projectRecords(orgId: string, projectId: number, slug: string): Promise<Array<{ id: number; title: string; status: string | null; meta: Record<string, unknown> }>> {
  const type = await getObjectTypeBySlug(orgId, slug);
  if (!type) {
    return [];
  }
  const rows = await db.select({ id: businessObjectSchema.id, title: businessObjectSchema.title, status: businessObjectSchema.status, metadata: businessObjectSchema.metadata }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.typeId, type.id), sql`${businessObjectSchema.metadata}->>'projectId' = ${String(projectId)}`)).orderBy(businessObjectSchema.id);
  return rows.map(r => ({ id: r.id, title: r.title, status: r.status, meta: (r.metadata ?? {}) as Record<string, unknown> }));
}
