/**
 * THE APP HOME, read — the server half of the page an app opens on
 * (`/dashboard/apps/<app>/home`, `app.yaml` `home:`). Each section has its
 * own loader so the page streams them one by one and a slow figure never
 * holds up the rest. Every read is bounded and none calls a model; a failed
 * read leaves its part out, never the page.
 *
 * What it reads is state core already keeps: the app's records (by type),
 * the workspace's projects, Review's proposals, saved views over synced
 * systems, mission and workflow runs, artifacts and asks. The pure half
 * (`libs/workspace/appHome.ts`) turns them into readings.
 */

import type { DecisionView } from '@/libs/decisions/decision';
import type { MeasureReading, StateFigure, WaitingProposal } from '@/libs/workspace/appHome';
import type { PageRow } from '@/libs/workspace/pageFields';
import type { AppHome, AppHomeMeasure, AppManifest } from '@/libs/workspace/schemas';
import { and, desc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { cache } from 'react';
import { installedApps } from '@/features/navigation/apps';
import { teamsOfApp } from '@/features/navigation/appTeams';
import { db } from '@/libs/DB';
import { projectsUsingApp, readApprovalsMeasure, readMissionMeasure, readProjectMeasure, readRecordsMeasure, readStateMeasure, recordTypesOf } from '@/libs/workspace/appHome';
import { agentSchema, artifactSchema, businessObjectSchema, businessObjectTypeSchema, missionRunSchema, missionSchema, projectSchema, teamSchema, workflowRunSchema, workflowSchema } from '@/models/Schema';

/** At most this many project blocks; the rest are one link away. */
export const HOME_PROJECTS_LIMIT = 8;
/** Records read per type for the figures. */
const RECORDS_PER_TYPE = 2000;
/** Runs and things made, each. */
const ACTIVITY_LIMIT = 6;
/** How far back "recent" reaches. */
const RECENT_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;
/** Where a workflow run keeps its label (`WorkflowService.RUN_LABEL_INPUT_KEY`; not imported, the service is heavy). */
const RUN_LABEL_INPUT_KEY = 'runLabel';

/** An app as one workspace has it, for its home. */
export type HomeScope = {
  app: AppManifest & { home: AppHome };
  /** The app's agents (its teams' members and leads). */
  agents: string[];
  /** The app's lead, by name, for the ask bar. */
  leadName: string | null;
  /** The app's agents' names, by slug, for a decision's eyebrow. */
  agentNames: Record<string, string>;
};

/**
 * The app, its home and its agents in this workspace. Null when the
 * workspace does not have the app, or the app declares no home. Read once
 * per request: every section starts from it.
 */
export const loadHomeScope = cache(async (orgId: string, appId: string): Promise<HomeScope | null> => {
  const [{ safeListApps }, { pluginTeams }, project] = await Promise.all([
    import('@/libs/workspace/apps'),
    import('@/services/chat/appFront'),
    db.select({ plugins: projectSchema.enabledPlugins, surfaces: projectSchema.enabledSurfaces }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1).then(r => r[0] ?? null),
  ]);
  if (!project) {
    return null;
  }
  const catalogue = safeListApps();
  const app = installedApps(project.plugins ?? [], project.surfaces ?? [], catalogue).find(a => a.id === appId);
  if (!app || app.core || !app.home) {
    return null;
  }
  const [teams, agents, shipped] = await Promise.all([
    db.select({ slug: teamSchema.slug, app: teamSchema.app, lead: teamSchema.leadAgentSlug }).from(teamSchema).where(eq(teamSchema.orgId, orgId)).orderBy(teamSchema.id),
    db.select({ slug: agentSchema.slug, name: agentSchema.name, team: agentSchema.teamSlug }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), isNotNull(agentSchema.teamSlug))),
    pluginTeams(),
  ]);
  const appTeams = teamsOfApp(app.id, teams, { apps: catalogue, pluginTeams: shipped });
  const leads = teams.filter(t => appTeams.includes(t.slug) && t.lead).map(t => t.lead!);
  const members = agents.filter(a => a.team && appTeams.includes(a.team)).map(a => a.slug);
  const lead = agents.find(a => a.slug === leads[0]);
  const slugs = [...new Set([...leads, ...members])];
  const agentNames = Object.fromEntries(agents.filter(a => slugs.includes(a.slug)).map(a => [a.slug, a.name]));
  return { app: app as HomeScope['app'], agents: slugs, leadName: lead?.name ?? null, agentNames };
});

/**
 * One type's records as page rows, newest first, bounded. On a project's
 * block, only the projects named.
 * @param orgId - The workspace.
 * @param typeSlug - The object type.
 * @param projectIds - Only records naming one of these projects (by `meta.projectId`), when given.
 */
async function recordRows(orgId: string, typeSlug: string, projectIds?: readonly number[]): Promise<PageRow[]> {
  const [type] = await db.select({ id: businessObjectTypeSchema.id }).from(businessObjectTypeSchema).where(and(eq(businessObjectTypeSchema.orgId, orgId), eq(businessObjectTypeSchema.slug, typeSlug))).limit(1);
  if (!type || (projectIds && projectIds.length === 0)) {
    return [];
  }
  const rows = await db
    .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, status: businessObjectSchema.status, createdAt: businessObjectSchema.createdAt, metadata: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .where(and(
      eq(businessObjectSchema.orgId, orgId),
      eq(businessObjectSchema.typeId, type.id),
      ...(projectIds ? [inArray(sql<string>`${businessObjectSchema.metadata}->>'projectId'`, projectIds.map(String))] : []),
    ))
    .orderBy(desc(businessObjectSchema.updatedAt))
    .limit(RECORDS_PER_TYPE);
  return rows.map(r => ({ id: r.id, title: r.title, status: r.status ?? null, createdAt: r.createdAt ?? null, meta: (r.metadata ?? {}) as Record<string, unknown> }));
}

/**
 * Proposals waiting in Review, as `approvals` measures read them.
 * @param orgId - The workspace.
 */
async function waitingProposals(orgId: string): Promise<WaitingProposal[]> {
  const { listReviewRows } = await import('@/services/inbox/reviewRows');
  const rows = await listReviewRows(orgId, 'open');
  return rows
    .filter(r => r.status === 'pending')
    .map(r => ({ actionId: r.actionId, createdAt: r.createdAt, input: (r.input ?? null) as Record<string, unknown> | null }));
}

/**
 * A `state` measure's read: its view (or query), counted, and summed when it asks.
 * @param orgId - The workspace.
 * @param userId - The person (a view may be theirs, and `$me` is them).
 * @param measure - The declaration.
 */
async function stateFigure(orgId: string, userId: string, measure: AppHomeMeasure): Promise<{ figure: StateFigure; name: string } | null> {
  const [{ checkQuery, runStateQuery, viewBySlug }, { handlesOf }, { userSchema }] = await Promise.all([
    import('@/services/state/state'),
    import('@/libs/retrieval/facets'),
    import('@/models/Schema'),
  ]);
  const view = measure.view ? await viewBySlug(measure.view, { orgId, userId }) : undefined;
  if (measure.view && !view) {
    return null;
  }
  const query = { ...(view ? view.query : measure.query as { sets: string[]; filter?: Record<string, never> }), limit: 1, ...(measure.sum ? { sum: measure.sum } : {}) };
  if (checkQuery(query).length > 0) {
    return null;
  }
  const [person] = await db.select({ email: userSchema.email, name: userSchema.name }).from(userSchema).where(eq(userSchema.id, userId)).limit(1);
  const read = await runStateQuery(query, { orgIds: [orgId], userId, me: person ? handlesOf(person) : [], now: new Date() });
  return { figure: { total: read.total, sum: read.sum ?? null, missing: read.missing, syncedAt: read.sources.map(s => s.syncedAt) }, name: view?.name ?? measure.label };
}

/**
 * The workspace's figures (`home.measures`), in the order declared. A
 * figure that cannot be read is left out.
 * @param orgId - The workspace.
 * @param userId - The person.
 * @param scope - The app.
 */
export async function loadWorkspaceMeasures(orgId: string, userId: string, scope: HomeScope): Promise<MeasureReading[]> {
  const measures = scope.app.home.measures ?? [];
  if (measures.length === 0) {
    return [];
  }
  const now = new Date();
  const needsProposals = measures.some(m => m.source === 'approvals');
  const proposals = needsProposals ? await waitingProposals(orgId).catch(() => []) : [];
  const readings = await Promise.all(measures.map(async (m): Promise<MeasureReading | null> => {
    try {
      switch (m.source) {
        case 'records':
          return readRecordsMeasure(m, await recordRows(orgId, m.objectType!), { now });
        case 'approvals':
          return readApprovalsMeasure(m, proposals);
        case 'state': {
          const read = await stateFigure(orgId, userId, m);
          return read ? readStateMeasure(m, read.figure, `/dashboard/chat?ask=${encodeURIComponent(`Show me ${read.name.toLowerCase()}`)}`) : null;
        }
        case 'mission': {
          const [run] = await db
            .select({ id: missionRunSchema.id, status: missionRunSchema.status, createdAt: missionRunSchema.createdAt, updatedAt: missionRunSchema.updatedAt, completedAt: missionRunSchema.completedAt })
            .from(missionRunSchema)
            .innerJoin(missionSchema, eq(missionSchema.id, missionRunSchema.missionId))
            .where(and(eq(missionRunSchema.orgId, orgId), eq(missionSchema.slug, m.mission!)))
            .orderBy(desc(missionRunSchema.createdAt))
            .limit(1);
          return readMissionMeasure(m, run ?? null);
        }
        default:
          return null;
      }
    } catch (error) {
      console.warn('[app-home] a figure could not be read', { orgId, measure: m.key, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }));
  return readings.filter((r): r is MeasureReading => r !== null);
}

/** One project's block on the home. */
export type HomeProject = { id: number; title: string; href: string; readings: MeasureReading[] };

/**
 * The projects that use the app and each one's figures
 * (`home.projects.measures`). Empty when the home declares no projects.
 * @param orgId - The workspace.
 * @param scope - The app.
 */
export async function loadHomeProjects(orgId: string, scope: HomeScope): Promise<{ projects: HomeProject[]; more: number }> {
  const spec = scope.app.home.projects;
  if (!spec) {
    return { projects: [], more: 0 };
  }
  const now = new Date();
  const [roomType] = await db.select({ id: businessObjectTypeSchema.id }).from(businessObjectTypeSchema).where(and(eq(businessObjectTypeSchema.orgId, orgId), eq(businessObjectTypeSchema.slug, 'data_room'))).limit(1);
  if (!roomType) {
    return { projects: [], more: 0 };
  }
  const types = recordTypesOf({ projects: spec });
  const [rooms, named] = await Promise.all([
    db
      .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, status: businessObjectSchema.status, createdAt: businessObjectSchema.createdAt, updatedAt: businessObjectSchema.updatedAt, metadata: businessObjectSchema.metadata })
      .from(businessObjectSchema)
      .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.typeId, roomType.id)))
      .orderBy(desc(businessObjectSchema.updatedAt))
      .limit(200),
    namedProjects(orgId, types),
  ]);
  const rows = rooms.map(r => ({ id: r.id, title: r.title, status: r.status ?? null, createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null, meta: (r.metadata ?? {}) as Record<string, unknown> }));
  const using = projectsUsingApp(rows, named, spec.include, { limit: rows.length, now });
  const shown = using.slice(0, HOME_PROJECTS_LIMIT);
  const ids = shown.map(p => Number(p.id));
  const needsProposals = spec.measures.some(m => m.source === 'approvals');
  const [byType, proposals] = await Promise.all([
    Promise.all(types.map(async t => [t, await recordRows(orgId, t, ids).catch(() => [])] as const)).then(e => new Map(e)),
    needsProposals ? waitingProposals(orgId).catch(() => []) : Promise.resolve([]),
  ]);
  const projects = shown.map((project): HomeProject => {
    const id = Number(project.id);
    const readings = spec.measures.map((m) => {
      if (m.source === 'project') {
        return readProjectMeasure(m, project);
      }
      if (m.source === 'approvals') {
        return readApprovalsMeasure(m, proposals, id);
      }
      const rowsOf = (byType.get(m.objectType!) ?? []).filter(r => String(resolveProject(r, m.projectField)) === String(id));
      return readRecordsMeasure(m, rowsOf, { project, now });
    }).filter((r): r is MeasureReading => r !== null);
    return { id, title: project.title, href: `/dashboard/projects/${id}`, readings };
  });
  return { projects, more: Math.max(0, using.length - shown.length) };
}

function resolveProject(row: PageRow, field: string): unknown {
  const path = field.startsWith('meta.') ? field.slice(5) : field;
  let cur: unknown = row.meta;
  for (const part of path.split('.')) {
    cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[part] : undefined;
  }
  return cur;
}

/**
 * The project ids the app's records name (`meta.projectId`), bounded.
 * @param orgId - The workspace.
 * @param types - The app's record types.
 */
async function namedProjects(orgId: string, types: readonly string[]): Promise<Set<number>> {
  if (types.length === 0) {
    return new Set();
  }
  const rows = await db
    .selectDistinct({ projectId: sql<string | null>`${businessObjectSchema.metadata}->>'projectId'` })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectTypeSchema.orgId, orgId), inArray(businessObjectTypeSchema.slug, [...types])))
    .limit(500);
  return new Set(rows.map(r => Number(r.projectId)).filter(n => Number.isInteger(n) && n > 0));
}

/** Something in flight or recently made, as the home lists it. */
export type HomeActivityItem = { key: string; title: string; href: string; at: string; state: string };

/**
 * What the app's agents are running now and what they recently made.
 * Running: mission runs its agents lead and workflow runs of workflows they
 * own, not yet finished. Recent: artifacts its agents wrote in the last two
 * weeks. Each list at most {@link ACTIVITY_LIMIT}.
 * @param orgId - The workspace.
 * @param scope - The app.
 */
export async function loadHomeActivity(orgId: string, scope: HomeScope): Promise<{ running: HomeActivityItem[]; recent: HomeActivityItem[] }> {
  if (scope.agents.length === 0) {
    return { running: [], recent: [] };
  }
  const since = new Date(Date.now() - RECENT_DAYS * DAY);
  const authorIds = scope.agents.flatMap(a => [a, `agent:${a}`]);
  const [missions, flows, made] = await Promise.all([
    db
      .select({ id: missionRunSchema.id, title: missionRunSchema.title, status: missionRunSchema.status, createdAt: missionRunSchema.createdAt })
      .from(missionRunSchema)
      .where(and(eq(missionRunSchema.orgId, orgId), inArray(missionRunSchema.status, ['planning', 'running', 'paused', 'awaiting_review']), inArray(sql<string>`${missionRunSchema.team}->>'lead'`, scope.agents)))
      .orderBy(desc(missionRunSchema.createdAt))
      .limit(ACTIVITY_LIMIT)
      .catch(() => []),
    db
      .select({ id: workflowRunSchema.id, status: workflowRunSchema.status, createdAt: workflowRunSchema.createdAt, input: workflowRunSchema.input, slug: workflowSchema.slug, name: workflowSchema.name })
      .from(workflowRunSchema)
      .innerJoin(workflowSchema, eq(workflowSchema.id, workflowRunSchema.workflowId))
      .where(and(eq(workflowRunSchema.orgId, orgId), inArray(workflowRunSchema.status, ['running', 'paused']), inArray(workflowSchema.ownerAgentSlug, scope.agents)))
      .orderBy(desc(workflowRunSchema.createdAt))
      .limit(ACTIVITY_LIMIT)
      .catch(() => []),
    db
      .select({ id: artifactSchema.id, title: artifactSchema.title, updatedAt: artifactSchema.updatedAt })
      .from(artifactSchema)
      .where(and(eq(artifactSchema.orgId, orgId), eq(artifactSchema.lastAuthorKind, 'agent'), inArray(artifactSchema.lastAuthorId, authorIds), eq(artifactSchema.visibility, 'user'), gt(artifactSchema.updatedAt, since)))
      .orderBy(desc(artifactSchema.updatedAt))
      .limit(ACTIVITY_LIMIT)
      .catch(() => []),
  ]);
  const running: HomeActivityItem[] = [
    ...missions.map(m => ({ key: `mission:${m.id}`, title: m.title, href: `/dashboard/missions/runs/${m.id}`, at: m.createdAt.toISOString(), state: m.status })),
    ...flows.map((f) => {
      const label = (f.input as Record<string, unknown> | null)?.[RUN_LABEL_INPUT_KEY];
      return { key: `workflow:${f.id}`, title: typeof label === 'string' && label.trim() ? label : f.name, href: `/dashboard/workflows/${encodeURIComponent(f.slug)}/runs/${f.id}`, at: f.createdAt.toISOString(), state: f.status };
    }),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, ACTIVITY_LIMIT);
  const recent = made.map(a => ({ key: `artifact:${a.id}`, title: a.title, href: `/dashboard/artifacts/${a.id}`, at: a.updatedAt.toISOString(), state: 'made' }));
  return { running, recent };
}

/**
 * What waits on the person from the app's agents.
 * @param orgId - The workspace.
 * @param userId - The person.
 * @param scope - The app.
 */
export async function loadHomeDecisions(orgId: string, userId: string, scope: HomeScope): Promise<DecisionView[]> {
  const { decisionsFromAgents } = await import('@/services/decisions/DecisionService');
  return decisionsFromAgents(orgId, userId, scope.agents);
}

/**
 * Whether the app has anything yet in this workspace — a project using it,
 * a record of its types, a run or an artifact of its agents, or a decision
 * waiting. Cheap: each is one bounded read. A new app shows the ask bar and
 * its first tile only.
 * @param orgId - The workspace.
 * @param userId - The person.
 * @param scope - The app.
 */
export async function homeHasWork(orgId: string, userId: string, scope: HomeScope): Promise<boolean> {
  const types = recordTypesOf(scope.app.home);
  const [records, activity, decisions] = await Promise.all([
    types.length === 0
      ? Promise.resolve(false)
      : db
          .select({ id: businessObjectSchema.id })
          .from(businessObjectSchema)
          .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
          .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectTypeSchema.orgId, orgId), inArray(businessObjectTypeSchema.slug, types)))
          .limit(1)
          .then(r => r.length > 0)
          .catch(() => false),
    hasAgentWork(orgId, scope.agents),
    loadHomeDecisions(orgId, userId, scope).then(d => d.length > 0).catch(() => false),
  ]);
  return records || activity || decisions;
}

async function hasAgentWork(orgId: string, agents: readonly string[]): Promise<boolean> {
  if (agents.length === 0) {
    return false;
  }
  const authorIds = agents.flatMap(a => [a, `agent:${a}`]);
  const [missions, made] = await Promise.all([
    db.select({ id: missionRunSchema.id }).from(missionRunSchema).where(and(eq(missionRunSchema.orgId, orgId), inArray(sql<string>`${missionRunSchema.team}->>'lead'`, [...agents]))).limit(1).catch(() => []),
    db.select({ id: artifactSchema.id }).from(artifactSchema).where(and(eq(artifactSchema.orgId, orgId), eq(artifactSchema.lastAuthorKind, 'agent'), inArray(artifactSchema.lastAuthorId, authorIds))).limit(1).catch(() => []),
  ]);
  return missions.length > 0 || made.length > 0;
}
