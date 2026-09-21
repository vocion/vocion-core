import type { PageOverviewPanel } from '@/libs/workspace/pageFields';
import type { FactoryOverview, OverviewAsk, OverviewProposal, OverviewRecord } from '@/services/factory/overview';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema, askSchema, businessObjectSchema, businessObjectTypeSchema } from '@/models/Schema';
import { assembleOverview } from '@/services/factory/overview';
import { markPageSeen } from '@/services/NavPrefService';
import { deriveHumanLoad, emptyHumanLoadCounts, foldHumanLoad, readHumanLoadRows } from '@/services/team-report/humanLoad';

/**
 * The half of the `overview` archetype that knows the tables.
 *
 * Every read is scoped by org. Nothing here decides what a panel means -
 * `overview.ts` does that, on plain objects, so the meaning is unit-testable
 * without a database.
 *
 * Which tables, and why each one:
 *
 * | panel      | source                                                      |
 * |------------|-------------------------------------------------------------|
 * | status     | `business_object` of the type the panel names                |
 * | digest     | the same objects, by created/updated stamp                   |
 * | active     | `business_object` outcomes, joined to their task objects     |
 * | next       | `business_object`, ordered by the manifest's `orderBy`       |
 * | needsYou   | `ask` (open) + `action_run` (pending)                        |
 * | economics  | `business_object` money fields                               |
 * | autonomy   | the team report's human-load fold (`team-report/humanLoad`)  |
 *
 * The human-load fold is reused rather than reimplemented on purpose: the
 * Performance surface and this page must not be able to disagree about how
 * much ran without a person.
 */

const MAX_OBJECTS_PER_TYPE = 500;

/**
 * Every object type any panel reads.
 * @param panels
 */
function typesNamedBy(panels: readonly PageOverviewPanel[]): string[] {
  const slugs = new Set<string>();
  for (const panel of panels) {
    switch (panel.kind) {
      case 'status':
        slugs.add(panel.objectType);
        for (const fact of panel.facts) {
          if (fact.kind === 'related') {
            slugs.add(fact.objectType);
          }
        }
        break;
      case 'digest':
        for (const a of panel.arrivals) {
          slugs.add(a.objectType);
        }
        for (const t of panel.transitions) {
          slugs.add(t.objectType);
        }
        for (const r of panel.rollups) {
          slugs.add(r.objectType);
        }
        break;
      case 'active':
        slugs.add(panel.objectType);
        if (panel.tasks) {
          slugs.add(panel.tasks.objectType);
        }
        break;
      case 'next':
      case 'economics':
        slugs.add(panel.objectType);
        break;
      default:
        break;
    }
  }
  return [...slugs];
}

/**
 * The furthest back any panel looks, in days - one window for every read.
 * @param panels
 * @param lastSeenAt
 * @param now
 */
function widestWindowDays(panels: readonly PageOverviewPanel[], lastSeenAt: Date | null, now: Date): number {
  let days = 1;
  for (const panel of panels) {
    if (panel.kind === 'economics' || panel.kind === 'autonomy') {
      days = Math.max(days, panel.windowDays);
    }
    if (panel.kind === 'digest') {
      days = Math.max(days, Math.ceil(panel.fallbackHours / 24));
    }
  }
  if (lastSeenAt) {
    days = Math.max(days, Math.ceil((now.getTime() - lastSeenAt.getTime()) / 86_400_000));
  }
  return Math.min(days, 400);
}

async function readRecords(orgId: string, typeSlugs: string[]): Promise<OverviewRecord[]> {
  if (typeSlugs.length === 0) {
    return [];
  }
  const rows = await db
    .select({
      id: businessObjectSchema.id,
      title: businessObjectSchema.title,
      status: businessObjectSchema.status,
      metadata: businessObjectSchema.metadata,
      createdAt: businessObjectSchema.createdAt,
      updatedAt: businessObjectSchema.updatedAt,
      typeSlug: businessObjectTypeSchema.slug,
    })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectSchema.typeId, businessObjectTypeSchema.id))
    .where(and(eq(businessObjectSchema.orgId, orgId), inArray(businessObjectTypeSchema.slug, typeSlugs)))
    .limit(MAX_OBJECTS_PER_TYPE * typeSlugs.length);
  return rows.map(r => ({
    id: r.id,
    title: r.title ?? '',
    status: r.status ?? null,
    meta: (r.metadata ?? {}) as Record<string, unknown>,
    createdAt: r.createdAt ? new Date(r.createdAt) : null,
    updatedAt: r.updatedAt ? new Date(r.updatedAt) : null,
    typeSlug: r.typeSlug,
  }));
}

async function readAsks(orgId: string, since: Date): Promise<OverviewAsk[]> {
  const rows = await db
    .select({
      id: askSchema.id,
      kind: askSchema.kind,
      title: askSchema.title,
      risk: askSchema.risk,
      decisionCost: askSchema.decisionCost,
      status: askSchema.status,
      createdAt: askSchema.createdAt,
      decidedAt: askSchema.decidedAt,
      objectRefs: askSchema.objectRefs,
    })
    .from(askSchema)
    .where(and(eq(askSchema.orgId, orgId), gte(askSchema.createdAt, since)));
  const open = await db
    .select({
      id: askSchema.id,
      kind: askSchema.kind,
      title: askSchema.title,
      risk: askSchema.risk,
      decisionCost: askSchema.decisionCost,
      status: askSchema.status,
      createdAt: askSchema.createdAt,
      decidedAt: askSchema.decidedAt,
      objectRefs: askSchema.objectRefs,
    })
    .from(askSchema)
    .where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open')));
  const byId = new Map<number, OverviewAsk>();
  for (const r of [...rows, ...open]) {
    byId.set(r.id, {
      id: r.id,
      kind: r.kind,
      title: r.title ?? '',
      risk: r.risk ?? null,
      decisionCost: typeof r.decisionCost === 'number' ? r.decisionCost : null,
      status: r.status,
      createdAt: new Date(r.createdAt),
      decidedAt: r.decidedAt ? new Date(r.decidedAt) : null,
      objectRefs: r.objectRefs ?? [],
    });
  }
  return [...byId.values()];
}

async function readPendingProposals(orgId: string): Promise<OverviewProposal[]> {
  const rows = await db
    .select({ id: actionRunSchema.id, actionId: actionRunSchema.actionId, createdAt: actionRunSchema.createdAt })
    .from(actionRunSchema)
    .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.status, 'pending')));
  return rows.map(r => ({ id: r.id, title: `Action · ${r.actionId}`, createdAt: new Date(r.createdAt) }));
}

/**
 * Build the whole page for one org, one viewer and one manifest.
 *
 * The viewer's last visit is read BEFORE it is written, so the digest still
 * shows what changed since the previous visit rather than emptying itself the
 * moment the page renders. A viewer who has never opened the page gets null,
 * and the digest heading says so instead of passing a default window off as a
 * memory.
 * @param input
 * @param input.orgId - Tenant.
 * @param input.userId - The viewer, or null when there is no session user; a
 *   null viewer is never remembered and always reads as a first visit.
 * @param input.slug - The page slug the visit is recorded under.
 * @param input.panels - The manifest's panels, in order.
 * @param input.now - The clock.
 */
export async function loadFactoryOverview(input: {
  orgId: string;
  userId: string | null;
  slug: string;
  panels: readonly PageOverviewPanel[];
  now?: Date;
}): Promise<FactoryOverview> {
  const now = input.now ?? new Date();
  const lastSeenAt = input.userId
    ? await markPageSeen({ orgId: input.orgId, userId: input.userId, slug: input.slug, at: now })
    : null;

  const days = widestWindowDays(input.panels, lastSeenAt, now);
  const since = new Date(now.getTime() - days * 86_400_000);
  const wantsAutonomy = input.panels.some(p => p.kind === 'autonomy');

  const [records, asks, pendingProposals, humanLoadRows] = await Promise.all([
    readRecords(input.orgId, typesNamedBy(input.panels)),
    readAsks(input.orgId, since),
    readPendingProposals(input.orgId),
    wantsAutonomy ? readHumanLoadRows(input.orgId, { since, until: now }) : Promise.resolve(null),
  ]);

  const humanLoad = humanLoadRows
    ? deriveHumanLoad(foldHumanLoad(humanLoadRows, [], now).get(null) ?? emptyHumanLoadCounts())
    : null;

  return assembleOverview({
    panels: input.panels,
    records,
    asks,
    pendingProposals,
    humanLoad,
    lastSeenAt,
    now,
  });
}
