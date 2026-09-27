/**
 * THE RELEASE PACK: what a deploy shipped, and the proof.
 *
 * Chris, 2026-09-27: "how do I know what work is done?" Until now a feature
 * read Shipped because an agent or a person said so; the deploy wrote a
 * release that named no feature. Now the deploy names the pull requests it
 * carried, and this links each one — in code, not by an agent — to its
 * engineering task and its request, carries QA's verdict and screenshots onto
 * the release, and marks the request shipped. A pull request a revert in the
 * same notes undid is not shipped (#66 on 2026-09-27 went out and came back).
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { artifactSchema, businessObjectSchema, businessObjectTypeSchema } from '@/models/Schema';

/**
 * `https://github.com/o/r/pull/12/files` → `https://github.com/o/r/pull/12`.
 * @param url
 */
function normalPr(url: string): string {
  return url.trim().replace(/\/(files|commits|checks)\/?$/, '').replace(/\/$/, '');
}

/**
 * The pull requests a release shipped: the ones it names, minus any that a
 * revert commit in its own notes names.
 * @param meta - The release's metadata (`prUrls`, `commits`).
 */
export function shippedPrs(meta: Record<string, unknown>): { shipped: string[]; reverted: string[] } {
  const named = (Array.isArray(meta.prUrls) ? meta.prUrls : []).filter((u): u is string => typeof u === 'string').map(normalPr);
  const commits = (Array.isArray(meta.commits) ? meta.commits : []).map(String);
  const revertedNumbers = new Set(
    commits
      .map(c => c.replace(/^[0-9a-f]{7,40}\s+/, ''))
      .filter(c => /^revert\b/i.test(c))
      .flatMap(c => [...c.matchAll(/#(\d+)/g)].map(m => m[1]!)),
  );
  const number = (u: string) => /\/pull\/(\d+)$/.exec(u)?.[1] ?? '';
  const unique = [...new Set(named)];
  return {
    shipped: unique.filter(u => !revertedNumbers.has(number(u))),
    reverted: unique.filter(u => revertedNumbers.has(number(u))),
  };
}

type Row = { id: number; title: string; meta: Record<string, unknown> };

async function objectsOfType(orgId: string, slug: string): Promise<Row[]> {
  const rows = await db
    .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, meta: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectTypeSchema.slug, slug)));
  return rows.map(r => ({ id: r.id, title: r.title, meta: (r.meta ?? {}) as Record<string, unknown> }));
}

async function mergeMeta(orgId: string, id: number, set: Record<string, unknown>): Promise<void> {
  await db
    .update(businessObjectSchema)
    .set({ metadata: sql`coalesce(${businessObjectSchema.metadata}, '{}'::jsonb) || ${JSON.stringify(set)}::jsonb`, updatedAt: new Date() })
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id)));
}

export type ReleaseEvidence = { taskId: number; requestId: number | null; prUrl: string; verdict: string };

/**
 * Link a release to what it shipped. Idempotent: running it again on the
 * same release writes the same pack.
 * @param orgId - The workspace.
 * @param releaseId - The release record.
 * @returns The pack written, or null when the release names no pull request.
 */
export async function linkRelease(orgId: string, releaseId: number): Promise<{ requestIds: number[]; taskIds: number[]; evidence: ReleaseEvidence[]; reverted: string[] } | null> {
  const [release] = await db
    .select({ meta: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, releaseId)))
    .limit(1);
  const meta = (release?.meta ?? {}) as Record<string, unknown>;
  const { shipped, reverted } = shippedPrs(meta);
  if (shipped.length === 0 && reverted.length === 0) {
    return null;
  }
  const tasks = (await objectsOfType(orgId, 'engineering_task'))
    .filter(t => typeof t.meta.prUrl === 'string' && shipped.includes(normalPr(t.meta.prUrl)));
  const evidence: ReleaseEvidence[] = tasks.map((t) => {
    const v = (t.meta.verdict ?? {}) as { value?: string; proven?: number; total?: number };
    const requestId = Number(t.meta.requestId);
    return {
      taskId: t.id,
      requestId: Number.isFinite(requestId) && requestId > 0 ? requestId : null,
      prUrl: normalPr(String(t.meta.prUrl)),
      // Shipped without a verdict is said plainly, never dressed up.
      verdict: v.value ? `${v.value}, ${v.proven ?? 0} of ${v.total ?? 0} proven` : 'merged without a QA verdict',
    };
  });
  const taskIds = evidence.map(e => e.taskId);
  const requestIds = [...new Set(evidence.map(e => e.requestId).filter((id): id is number => id !== null))];
  const shots = taskIds.length === 0
    ? []
    : await db
        .select({ id: artifactSchema.id })
        .from(artifactSchema)
        .where(and(eq(artifactSchema.orgId, orgId), sql`${artifactSchema.recordRole} = 'qa-screenshot'`, sql`${artifactSchema.recordId} in (${sql.join(taskIds.map(id => sql`${String(id)}`), sql`, `)})`));
  // The one line the Releases row leads with: which features, and the proof.
  const titleOf = new Map(tasks.map(t => [t.id, t.title]));
  const shippedLine = evidence.length > 0
    ? evidence.map(e => `${titleOf.get(e.taskId) ?? `task #${e.taskId}`} — QA ${e.verdict}`).join('; ')
    : 'No factory feature in this deploy';
  await mergeMeta(orgId, releaseId, {
    shippedLine,
    prUrls: [...shipped, ...reverted],
    taskIds,
    requestIds,
    evidence,
    revertedPrUrls: reverted,
    verificationArtifactIds: shots.map(s => s.id),
  });
  const releasedAt = typeof meta.releasedAt === 'string' ? meta.releasedAt : new Date().toISOString();
  for (const id of requestIds) {
    await mergeMeta(orgId, id, { state: 'shipped', shippedAt: releasedAt, shippedIn: releaseId });
  }
  const { recomputeRollupsForObject } = await import('@/services/objects/rollups');
  await recomputeRollupsForObject(orgId, releaseId).catch(() => undefined);
  return { requestIds, taskIds, evidence, reverted };
}
