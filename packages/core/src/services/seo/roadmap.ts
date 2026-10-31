import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { accountMembershipSchema, askSchema, businessObjectSchema, businessObjectTypeSchema, projectSchema, userSchema } from '@/models/Schema';
import { getDataRoom, roomGroupKey } from '@/services/DataRoomService';
import { getGoal } from '@/services/objectives/GoalService';
import { reachForAccount } from '@/services/WorkspaceAccessService';
import { WriteApiError } from '@/services/writeApi';
import { mergeMeta } from './records';
import { getStrategy, projectRecords } from './strategy';

const day = z.iso.date();
const evidenceUrl = z.string().max(2000).refine(v => /^https?:\/\//i.test(v) || /^\/dashboard(?:\/|\?|$)/.test(v), 'Use an HTTPS/HTTP URL or a workspace dashboard link.');
const initiative = z.object({
  id: z.string().min(1).max(100),
  label: z.string().min(2).max(200),
  lane: z.enum(['now', 'next', 'later']),
  ownerUserId: z.string().min(1).optional(),
  due: day.optional(),
  dependsOn: z.array(z.string()).max(50),
  blockedReason: z.string().max(1000).optional(),
  acceptanceCriteria: z.string().max(2000),
  nextAction: z.string().max(1000).optional(),
  effort: z.string().max(200).optional(),
  rationale: z.string().max(2000).optional(),
  recordIds: z.array(z.number().int().positive()).max(50),
  taskIds: z.array(z.number().int().positive()).max(50).default([]),
  evidence: z.array(z.object({ label: z.string().min(1).max(200), url: evidenceUrl })).max(30),
  status: z.enum(['planned', 'in_progress', 'blocked', 'done']),
});

export const roadmapSchema = z.object({
  revision: z.number().int().nonnegative(),
  initiatives: z.array(initiative).max(100),
  outcomes: z.array(z.object({
    id: z.string().min(1).max(100),
    label: z.string().min(2).max(200),
    unit: z.string().max(100),
    baseline: z.number().finite().optional(),
    target: z.number().finite().optional(),
    current: z.number().finite().optional(),
    source: z.string().max(2000).optional(),
    baselineWindowStart: day.optional(),
    baselineWindowEnd: day.optional(),
    baselineObservedAt: z.iso.datetime().optional(),
    windowStart: day.optional(),
    windowEnd: day.optional(),
    observedAt: z.iso.datetime().optional(),
  })).max(30),
}).superRefine((value, ctx) => {
  const byId = new Map(value.initiatives.map(i => [i.id, i]));
  if (byId.size !== value.initiatives.length || new Set(value.outcomes.map(o => o.id)).size !== value.outcomes.length) {
    ctx.addIssue({ code: 'custom', message: 'IDs must be unique.' });
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) {
      return false;
    }
    if (visited.has(id)) {
      return true;
    }
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      if (!byId.has(dependency) || !visit(dependency)) {
        return false;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  if (value.initiatives.some(i => !visit(i.id))) {
    ctx.addIssue({ code: 'custom', message: 'Dependencies must exist and cannot form a cycle.' });
  }
  for (const o of value.outcomes) {
    if (o.windowStart && o.windowEnd && o.windowStart > o.windowEnd) {
      ctx.addIssue({ code: 'custom', message: 'Outcome measurement window ends before it starts.' });
    }
    if (o.baselineWindowStart && o.baselineWindowEnd && o.baselineWindowStart > o.baselineWindowEnd) {
      ctx.addIssue({ code: 'custom', message: 'Baseline measurement window ends before it starts.' });
    }
    if (o.baseline !== undefined && (!o.source?.trim() || !o.baselineObservedAt || !o.baselineWindowStart || !o.baselineWindowEnd)) {
      ctx.addIssue({ code: 'custom', message: 'A baseline needs a source, observation date, and measurement window.' });
    }
    if (o.current !== undefined && (!o.source?.trim() || !o.observedAt || !o.windowStart || !o.windowEnd)) {
      ctx.addIssue({ code: 'custom', message: 'A measured result needs a source, observation date, and measurement window.' });
    }
  }
});

export type SeoRoadmap = z.infer<typeof roadmapSchema>;
const FINISHED = new Set(['done', 'complete', 'completed', 'closed', 'published', 'resolved', 'delivered']);

function verifiedPublication(meta: Record<string, unknown>): boolean {
  const publishedAt = typeof meta.publishedAt === 'string' ? Date.parse(meta.publishedAt) : Number.NaN;
  const proof = meta.publicationVerification as { status?: string; url?: string; checkedAt?: string } | undefined;
  const checkedAt = proof?.checkedAt ? Date.parse(proof.checkedAt) : Number.NaN;
  return proof?.status === 'verified' && proof.url === meta.publishedUrl && Number.isFinite(checkedAt) && checkedAt <= Date.now() && checkedAt >= publishedAt && meta.status === 'published' && typeof meta.publishedUrl === 'string' && /^https?:\/\//i.test(meta.publishedUrl) && Number.isFinite(publishedAt) && publishedAt <= Date.now();
}

/**
 * Read execution evidence from this client only; a roadmap never borrows another client's records.
 * @param orgId - The workspace.
 * @param projectId - The client project.
 * @param ids - Optional execution record IDs.
 */
async function recordsFor(orgId: string, projectId: number, ids?: number[]) {
  if (ids && !ids.length) {
    return [];
  }
  const rows = await db.select({ id: businessObjectSchema.id, title: businessObjectSchema.title, status: businessObjectSchema.status, typeSlug: businessObjectTypeSchema.slug, metadata: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectTypeSchema.orgId, orgId), inArray(businessObjectTypeSchema.slug, ['seo_page', 'seo_batch', 'seo_audit', 'seo_prompt', 'engineering_task']), sql`${businessObjectSchema.metadata}->>'projectId' = ${String(projectId)}`, ...(ids ? [inArray(businessObjectSchema.id, ids)] : [])));
  const batchPages = rows.some(r => r.typeSlug === 'seo_batch') ? await projectRecords(orgId, projectId, 'seo_page') : [];
  return rows.filter(r => Number((r.metadata as Record<string, unknown> | null)?.projectId) === projectId)
    .map((r) => {
      const meta = r.metadata as Record<string, unknown>;
      let status = r.status ?? 'unknown';
      if (r.typeSlug === 'seo_page') {
        status = verifiedPublication(meta) ? 'published' : FINISHED.has(String(meta.status)) ? 'publication_unverified' : String(meta.status ?? 'unknown');
      }
      if (r.typeSlug === 'seo_batch' && FINISHED.has(status)) {
        const kept = batchPages.filter(p => p.meta.batchId === r.id && p.meta.status !== 'rejected');
        if (!kept.length || !kept.every(p => verifiedPublication(p.meta))) {
          status = 'publication_unverified';
        }
      }
      if (r.typeSlug === 'seo_audit' && FINISHED.has(status)) {
        const coverage = meta.coverage as { complete?: boolean } | undefined;
        const findings = Array.isArray(meta.findings) ? meta.findings as Array<{ verification?: string; status?: string; severity?: string }> : [];
        if (!coverage?.complete || findings.some(f => f.verification === 'not_checked' || (f.status === 'fixed' && f.verification !== 'verified_fixed') || f.status === 'open')) {
          status = 'verification_required';
        }
      }
      return { id: r.id, title: r.title, status, href: `/dashboard/objects/${r.id}` };
    });
}

async function tasksFor(orgId: string, projectId: number, ids?: number[]) {
  if (ids && !ids.length) {
    return [];
  }
  const rows = await db.select({ id: askSchema.id, title: askSchema.title, status: askSchema.status, decision: askSchema.decision, options: askSchema.options }).from(askSchema).where(and(
    eq(askSchema.orgId, orgId),
    eq(askSchema.kind, 'input'),
    or(eq(askSchema.groupKey, roomGroupKey(projectId)), sql`${askSchema.objectRefs} @> ${JSON.stringify([{ type: 'object', id: String(projectId) }])}::jsonb`),
    ...(ids ? [inArray(askSchema.id, ids)] : []),
  ));
  return rows.filter(r => r.options.some(o => o.id === 'done')).map(r => ({ id: r.id, title: r.title, status: r.status === 'done' ? r.decision === 'done' ? 'done' : 'answered' : r.status, href: `/dashboard/inbox/${r.id}` }));
}

async function ownersFor(orgId: string) {
  const [workspace] = await db.select({ accountId: projectSchema.accountId }).from(projectSchema).where(eq(projectSchema.id, orgId));
  if (!workspace) {
    return [];
  }
  const people = await db.select({ id: userSchema.id, name: userSchema.name }).from(userSchema).innerJoin(accountMembershipSchema, eq(accountMembershipSchema.userId, userSchema.id)).where(eq(accountMembershipSchema.accountId, workspace.accountId));
  const access = await reachForAccount(workspace.accountId, people.map(p => p.id));
  return people.filter(p => access.get(p.id)?.some(w => w.projectId === orgId)).map(p => ({ id: p.id, name: p.name ?? p.id }));
}

/**
 * Read the roadmap and its current execution evidence. Caller must authenticate workspace membership.
 * @param orgId - The workspace.
 * @param projectId - The client project.
 * @param userId - The authenticated person.
 */
export async function readSeoRoadmap(orgId: string, projectId: number, userId: string) {
  if (!await getDataRoom(orgId, projectId)) {
    throw new WriteApiError(404, 'not_found', 'Project not found in this workspace.');
  }
  const strategy = await getStrategy(orgId, projectId);
  const goal = strategy?.meta.goalId ? await getGoal(orgId, strategy.meta.goalId) : null;
  const parsed = roadmapSchema.safeParse(strategy?.meta.roadmap);
  const roadmap: SeoRoadmap = parsed.success
    ? parsed.data
    : {
        revision: 0,
        initiatives: (Array.isArray(strategy?.meta.milestones) ? strategy.meta.milestones : []).filter(m => m && typeof m.label === 'string').map((m, index) => ({
          id: `milestone-${index + 1}`,
          label: m.label,
          lane: index === 0 ? 'now' : 'next',
          ...(goal ? { ownerUserId: goal.ownerUserId } : {}),
          dependsOn: [],
          acceptanceCriteria: m.label,
          taskIds: [],
          recordIds: typeof m.href === 'string' && m.href.match(/^\/dashboard\/objects\/(\d+)$/) ? [Number(m.href.split('/').at(-1))] : [],
          evidence: [],
          status: 'planned',
        })),
        outcomes: [],
      };
  const linkedRecords = await recordsFor(orgId, projectId, [...new Set(roadmap.initiatives.flatMap(i => i.recordIds))]);
  const linkedTasks = await tasksFor(orgId, projectId, [...new Set(roadmap.initiatives.flatMap(i => i.taskIds))]);
  const finishedTasks = new Set(linkedTasks.filter(t => t.status === 'done').map(t => t.id));
  const finished = new Set(linkedRecords.filter(r => FINISHED.has(r.status)).map(r => r.id));
  const byId = new Map(roadmap.initiatives.map(i => [i.id, i]));
  const completion = new Map<string, boolean>();
  const complete = (id: string): boolean => {
    if (completion.has(id)) {
      return completion.get(id)!;
    }
    const item = byId.get(id);
    const done = Boolean(item && !item.blockedReason && (item.recordIds.length + item.taskIds.length) > 0 && item.recordIds.every(recordId => finished.has(recordId)) && item.taskIds.every(taskId => finishedTasks.has(taskId)) && item.dependsOn.every(complete));
    completion.set(id, done);
    return done;
  };
  const completed = new Set(roadmap.initiatives.filter(i => complete(i.id)).map(i => i.id));
  roadmap.initiatives = roadmap.initiatives.map(i => ({ ...i, status: i.blockedReason || i.dependsOn.some(id => !completed.has(id)) ? 'blocked' : completed.has(i.id) ? 'done' : i.status === 'done' || i.status === 'blocked' ? i.recordIds.length + i.taskIds.length > 0 ? 'in_progress' : 'planned' : i.status }));
  const [availableOwners, availableRecords, availableTasks] = await Promise.all([ownersFor(orgId), recordsFor(orgId, projectId), tasksFor(orgId, projectId)]);
  return { roadmap, strategy, canEdit: Boolean(goal && goal.ownerUserId === userId && goal.links.some(link => link.kind === 'room' && link.id === String(projectId))), linkedRecords, linkedTasks, availableOwners, availableRecords, availableTasks };
}

/**
 * Owner-only, optimistic, tenant/client-scoped roadmap edit. Editing never runs or approves work.
 * @param orgId - The workspace.
 * @param projectId - The client project.
 * @param userId - The authenticated person.
 * @param expectedRevision - The revision the editor read.
 * @param input - The validated input.
 */
export async function updateSeoRoadmap(orgId: string, projectId: number, userId: string, expectedRevision: number, input: z.input<typeof roadmapSchema>) {
  const current = await readSeoRoadmap(orgId, projectId, userId);
  if (!current.strategy || !current.canEdit) {
    throw new WriteApiError(403, 'forbidden', 'Only the approved strategy goal owner can edit its roadmap.');
  }
  const parsed = roadmapSchema.safeParse(input);
  if (!parsed.success) {
    throw new WriteApiError(400, 'invalid_roadmap', parsed.error.issues.map(i => i.message).join(' '));
  }
  const roadmap = parsed.data;
  if (roadmap.outcomes.some(o => [o.observedAt, o.baselineObservedAt].some(at => at && Date.parse(at) > Date.now()))) {
    throw new WriteApiError(400, 'future_observation', 'Measurements cannot be observed in the future.');
  }
  const ids = [...new Set(roadmap.initiatives.flatMap(i => i.recordIds))];
  const records = await recordsFor(orgId, projectId, ids);
  const taskIds = [...new Set(roadmap.initiatives.flatMap(i => i.taskIds))];
  const tasks = await tasksFor(orgId, projectId, taskIds);
  if (tasks.length !== taskIds.length) {
    throw new WriteApiError(400, 'invalid_tasks', 'Execution tasks must belong to this client and workspace.');
  }
  const finishedTasks = new Set(tasks.filter(t => t.status === 'done').map(t => t.id));
  if (records.length !== ids.length) {
    throw new WriteApiError(400, 'invalid_records', 'Execution records must belong to this client and workspace.');
  }
  // Assign only people whose real account and workspace memberships permit access.
  if (roadmap.initiatives.some(i => i.ownerUserId && !current.availableOwners.some(p => p.id === i.ownerUserId))) {
    throw new WriteApiError(400, 'invalid_owner', 'Initiative owners must be members of this workspace.');
  }
  const finished = new Set(records.filter(r => FINISHED.has(r.status)).map(r => r.id));
  if (roadmap.initiatives.some(i => i.status === 'done' && (!(i.recordIds.length + i.taskIds.length) || i.recordIds.some(id => !finished.has(id)) || i.taskIds.some(id => !finishedTasks.has(id))))) {
    throw new WriteApiError(400, 'unverified_delivery', 'Delivery completion requires completed linked work.');
  }
  await mergeMeta(orgId, current.strategy.id, (meta) => {
    if (meta.goalId !== current.strategy!.meta.goalId) {
      throw new WriteApiError(409, 'strategy_changed', 'The approved strategy changed. Reload before saving.');
    }
    const held = roadmapSchema.safeParse(meta.roadmap);
    if ((held.success ? held.data.revision : 0) !== expectedRevision || roadmap.revision !== expectedRevision) {
      throw new WriteApiError(409, 'revision_conflict', 'The roadmap changed. Reload before saving.');
    }
    return { roadmap: { ...roadmap, revision: expectedRevision + 1 }, updatedAt: new Date().toISOString() };
  });
  return readSeoRoadmap(orgId, projectId, userId);
}
