import type { PageRow } from '@/libs/workspace/pageFields';
import type { LinkedRecord, ReleaseLinked } from '@/libs/workspace/releaseFeed';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { artifactSchema, businessObjectSchema, businessObjectTypeSchema } from '@/models/Schema';
import { recordLinkerForOrg } from '@/services/objects/recordHref';

/**
 * The reads behind a release: the tasks and requests it names, its product's
 * name, and the evidence artifacts it cites. Everything the pure reading
 * (`libs/workspace/releaseFeed.ts`) needs and nothing it does not — a task
 * carries its QA report, its checks' output and its screenshots' captions,
 * and a Releases page of forty rows has no use for any of it.
 */

/** The fields of a linked task or request the reading uses. */
const LINKED_KEYS = [
  'kind',
  'outcome',
  'expectedResult',
  'objective',
  'requestId',
  'prUrl',
  'verdict',
  // `featureProof`: the work's acceptance lines and the attempt's contract.
  'acceptance',
  'acceptanceContract',
  'askedBy',
  'told',
  'result',
  'resultNote',
  'resultCheckedAt',
  'checkAfter',
  'howWeCheck',
  'shippedAt',
] as const;

function ids(values: unknown[]): number[] {
  return [...new Set(values.map(v => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : Number.NaN)).filter(n => Number.isSafeInteger(n) && n > 0))];
}

/**
 * The ids a release row names, directly or through its release pack.
 * @param row - A release row.
 */
export function linkedIdsOf(row: PageRow): number[] {
  const meta = row.meta ?? {};
  const evidence = Array.isArray(meta.evidence) ? meta.evidence as Array<Record<string, unknown>> : [];
  return ids([
    ...(Array.isArray(meta.taskIds) ? meta.taskIds : []),
    ...(Array.isArray(meta.requestIds) ? meta.requestIds : []),
    ...evidence.flatMap(e => [e?.taskId, e?.requestId]),
  ]);
}

async function recordsById(orgId: string, want: number[]): Promise<LinkedRecord[]> {
  if (want.length === 0) {
    return [];
  }
  const picked = sql.join(LINKED_KEYS.map(k => sql`${k}::text, ${businessObjectSchema.metadata} -> ${k}::text`), sql`, `);
  const rows = await db
    .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, type: businessObjectTypeSchema.slug, meta: sql<Record<string, unknown>>`jsonb_strip_nulls(jsonb_build_object(${picked}))` })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), inArray(businessObjectSchema.id, want)));
  return rows.map(r => ({ id: r.id, title: r.title, type: r.type, meta: r.meta ?? {} }));
}

/**
 * Everything the release rows name, in one pass: the tasks and requests
 * (and the requests those tasks name, when the release itself did not), and
 * each product's own name.
 * @param orgId - The workspace.
 * @param rows - Release rows.
 */
export async function loadReleaseLinked(orgId: string, rows: PageRow[]): Promise<ReleaseLinked> {
  const first = await recordsById(orgId, [...new Set(rows.flatMap(linkedIdsOf))]);
  const have = new Set(first.map(r => r.id));
  const second = await recordsById(orgId, ids(first.map(r => r.meta.requestId)).filter(id => !have.has(id)));
  const records = new Map([...first, ...second].map(r => [r.id, r]));

  const slugs = [...new Set(rows.map(r => r.meta?.product).filter((s): s is string => typeof s === 'string' && s !== ''))];
  const products = new Map<string, string>();
  if (slugs.length > 0) {
    const found = await db
      .select({ title: businessObjectSchema.title, slug: sql<string>`${businessObjectSchema.metadata} ->> 'slug'` })
      .from(businessObjectSchema)
      .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
      .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectTypeSchema.slug, 'product'), inArray(sql`${businessObjectSchema.metadata} ->> 'slug'`, slugs)));
    for (const p of found) {
      if (p.slug) {
        products.set(p.slug, p.title);
      }
    }
  }
  return { records, products, link: await recordLinkerForOrg(orgId) };
}

export type ReleaseArtifact = { id: number; title: string; kind: string; role: string | null };

/**
 * One release record, when the id names a release in this workspace.
 * @param orgId - The workspace.
 * @param id - The record id.
 */
export async function loadReleaseRow(orgId: string, id: number): Promise<PageRow | null> {
  const [r] = await db
    .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, status: businessObjectSchema.status, createdAt: businessObjectSchema.createdAt, meta: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id), eq(businessObjectTypeSchema.slug, 'release')))
    .limit(1);
  return r ? { id: r.id, title: r.title, status: r.status ?? null, createdAt: r.createdAt ?? null, meta: (r.meta ?? {}) as Record<string, unknown> } : null;
}

/**
 * The artifacts a release cites as evidence, by id, with their titles — so
 * the page draws "QA screenshot: Uploads … · desktop · after" rather than a
 * list of numbers.
 * @param orgId - The workspace.
 * @param artifactIds - `verificationArtifactIds`.
 */
export async function loadReleaseArtifacts(orgId: string, artifactIds: number[]): Promise<ReleaseArtifact[]> {
  const want = ids(artifactIds);
  if (want.length === 0) {
    return [];
  }
  const rows = await db
    .select({ id: artifactSchema.id, title: artifactSchema.title, kind: artifactSchema.kind, role: artifactSchema.recordRole })
    .from(artifactSchema)
    .where(and(eq(artifactSchema.orgId, orgId), inArray(artifactSchema.id, want)));
  return rows.map(r => ({ id: r.id, title: r.title, kind: r.kind, role: r.role ?? null }));
}
