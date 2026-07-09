/**
 * ActivityService — ONE stream for everything the team did, regardless of
 * what produced it: mission checks/briefs, workflow runs, event fires, and
 * source syncs. Backs /dashboard/activity (the "observe" surface in the
 * Chat · Review · Activity · Search daily-driver hierarchy).
 *
 * Read-only aggregation — each row links back to its native detail page.
 */

import type { SQL } from 'drizzle-orm';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import {
  eventLogSchema,
  knowledgeSourceSchema,
  missionRunSchema,
  missionSchema,
  sourceSyncCheckpointSchema,
  workflowRunSchema,
  workflowSchema,
} from '@/models/Schema';

export type ActivityKind = 'mission' | 'workflow' | 'event' | 'sync';

export type ActivityItem = {
  kind: ActivityKind;
  /** Stable per-kind key for React lists. */
  key: string;
  title: string;
  /**
   * Slug of the definition that produced this row (mission slug, workflow
   *  slug, source slug, event type). Null when there's no per-kind slug.
   */
  slug: string | null;
  /** Normalized status for filtering + styling. */
  status: string;
  /** What started it — 'automation:<slug>', 'schedule', a user id, 'event:<type>'. */
  invokedBy: string | null;
  /** Where clicking goes. */
  href: string;
  at: Date;
  /** One-line extra (error message, counts, event targets). */
  detail?: string;
};

export type ActivityFilter = {
  kind?: ActivityKind;
  /** Slug of the definition (mission/workflow/source/event.type). */
  slug?: string;
  limit?: number;
};

/** Statuses that mean a human should look. */
export const ATTENTION_STATUSES = new Set(['paused', 'awaiting_review', 'awaiting_approval', 'failed']);

/**
 * The combined feed, newest first. `limit` bounds EACH source before the
 * merge, so the page never loads unbounded history. Pass `kind` or `slug`
 * to narrow — used by drill-in links from mission/workflow/source pages.
 * @param orgId
 * @param filter
 */
export async function activityFeed(orgId: string, filter: ActivityFilter = {}): Promise<ActivityItem[]> {
  const { kind, slug, limit = 50 } = filter;
  const need = (k: ActivityKind) => !kind || kind === k;
  const missionWhere = (): SQL | undefined => (slug ? and(eq(missionRunSchema.orgId, orgId), eq(missionSchema.slug, slug)) : eq(missionRunSchema.orgId, orgId));
  const workflowWhere = (): SQL | undefined => (slug ? and(eq(workflowRunSchema.orgId, orgId), eq(workflowSchema.slug, slug)) : eq(workflowRunSchema.orgId, orgId));
  const eventWhere = (): SQL | undefined => (slug ? and(eq(eventLogSchema.orgId, orgId), eq(eventLogSchema.type, slug)) : eq(eventLogSchema.orgId, orgId));
  const syncWhere = (): SQL | undefined => (slug ? and(eq(sourceSyncCheckpointSchema.orgId, orgId), eq(knowledgeSourceSchema.slug, slug)) : eq(sourceSyncCheckpointSchema.orgId, orgId));

  const [missionRuns, workflowRuns, events, syncs] = await Promise.all([
    need('mission')
      ? db
          .select({
            id: missionRunSchema.id,
            title: missionRunSchema.title,
            status: missionRunSchema.status,
            createdBy: missionRunSchema.createdBy,
            createdAt: missionRunSchema.createdAt,
            missionSlug: missionSchema.slug,
          })
          .from(missionRunSchema)
          .leftJoin(missionSchema, eq(missionRunSchema.missionId, missionSchema.id))
          .where(missionWhere())
          .orderBy(desc(missionRunSchema.createdAt))
          .limit(limit)
      : [],
    need('workflow')
      ? db
          .select({
            id: workflowRunSchema.id,
            status: workflowRunSchema.status,
            createdBy: workflowRunSchema.createdBy,
            createdAt: workflowRunSchema.createdAt,
            error: workflowRunSchema.error,
            workflowSlug: workflowSchema.slug,
            workflowName: workflowSchema.name,
          })
          .from(workflowRunSchema)
          .innerJoin(workflowSchema, eq(workflowRunSchema.workflowId, workflowSchema.id))
          .where(workflowWhere())
          .orderBy(desc(workflowRunSchema.createdAt))
          .limit(limit)
      : [],
    need('event')
      ? db
          .select()
          .from(eventLogSchema)
          .where(eventWhere())
          .orderBy(desc(eventLogSchema.createdAt))
          .limit(limit)
      : [],
    need('sync')
      ? db
          .select({
            id: sourceSyncCheckpointSchema.id,
            status: sourceSyncCheckpointSchema.status,
            startedAt: sourceSyncCheckpointSchema.startedAt,
            counts: sourceSyncCheckpointSchema.counts,
            error: sourceSyncCheckpointSchema.error,
            sourceSlug: knowledgeSourceSchema.slug,
          })
          .from(sourceSyncCheckpointSchema)
          .innerJoin(knowledgeSourceSchema, eq(sourceSyncCheckpointSchema.sourceId, knowledgeSourceSchema.id))
          .where(syncWhere())
          .orderBy(desc(sourceSyncCheckpointSchema.startedAt))
          .limit(limit)
      : [],
  ]);

  const items: ActivityItem[] = [
    ...missionRuns.map((r): ActivityItem => ({
      kind: 'mission',
      key: `mission-${r.id}`,
      title: r.title ?? r.missionSlug ?? 'Mission run',
      slug: r.missionSlug ?? null,
      status: r.status ?? 'running',
      invokedBy: r.createdBy,
      href: `/dashboard/missions/runs/${r.id}`,
      at: r.createdAt ?? new Date(0),
    })),
    ...workflowRuns.map((r): ActivityItem => ({
      kind: 'workflow',
      key: `workflow-${r.id}`,
      title: r.workflowName ?? r.workflowSlug,
      slug: r.workflowSlug,
      status: r.status,
      invokedBy: r.createdBy,
      href: `/dashboard/workflows/${r.workflowSlug}/runs/${r.id}`,
      at: r.createdAt ?? new Date(0),
      detail: r.error ?? undefined,
    })),
    ...events.map((e): ActivityItem => ({
      kind: 'event',
      key: `event-${e.id}`,
      title: e.type,
      slug: e.type,
      status: e.triggered.length > 0 ? 'triggered' : 'no_match',
      invokedBy: e.invokedBy,
      href: '/dashboard/automation',
      at: e.createdAt ?? new Date(0),
      detail: e.triggered.length > 0 ? `started ${e.triggered.map(t => t.slug).join(', ')}` : 'no subscriber matched',
    })),
    ...syncs.map((s): ActivityItem => ({
      kind: 'sync',
      key: `sync-${s.id}`,
      title: `Sync: ${s.sourceSlug}`,
      slug: s.sourceSlug,
      status: s.status,
      invokedBy: null,
      href: `/dashboard/sources/${s.sourceSlug}`,
      at: s.startedAt,
      detail: s.error
        ?? Object.entries(s.counts ?? {}).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(', ')
        ?? undefined,
    })),
  ];

  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}
