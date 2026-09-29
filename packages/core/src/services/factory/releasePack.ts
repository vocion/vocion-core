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

import type { CriterionEvidence, ProofArtifact } from '@/libs/workspace/criterionEvidence';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { criterionEvidence } from '@/libs/workspace/criterionEvidence';
import { featureProof, risksLine } from '@/libs/workspace/featureProof';
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

export type ReleaseEvidence = {
  taskId: number;
  requestId: number | null;
  prUrl: string;
  verdict: string;
  title: string;
  /**
   * Each criterion of the attempt that counts, with the stored artifact that
   * proves it (`libs/workspace/criterionEvidence.ts`) — the release shows the
   * proof, not a count and a pile of links.
   */
  criteria: CriterionEvidence[];
};

/** What a release pack is, before it is written. */
export type ReleasePack = {
  requestIds: number[];
  taskIds: number[];
  evidence: ReleaseEvidence[];
  reverted: string[];
  /** The fields `linkRelease` merges onto the release. */
  releaseMeta: Record<string, unknown>;
  /** The fields it merges onto each request it closes. */
  requestMeta: Array<{ id: number; set: Record<string, unknown> }>;
};

/** The QA roles a release cites: the shots, and the named-test runs that prove what no shot can. */
const PROOF_ROLES = ['qa-screenshot', 'qa-test-run'] as const;

async function proofArtifacts(orgId: string, taskIds: number[]): Promise<Array<ProofArtifact & { taskId: number }>> {
  if (taskIds.length === 0) {
    return [];
  }
  const rows = await db
    .select({ id: artifactSchema.id, title: artifactSchema.title, kind: artifactSchema.kind, role: artifactSchema.recordRole, url: artifactSchema.url, recordId: artifactSchema.recordId, spec: artifactSchema.spec })
    .from(artifactSchema)
    .where(and(
      eq(artifactSchema.orgId, orgId),
      sql`${artifactSchema.recordRole} in (${sql.join(PROOF_ROLES.map(r => sql`${r}`), sql`, `)})`,
      sql`${artifactSchema.recordId} in (${sql.join(taskIds.map(id => sql`${String(id)}`), sql`, `)})`,
    ));
  return rows
    .map((r) => {
      const spec = (r.spec ?? {}) as Record<string, unknown>;
      const url = r.url ?? (typeof spec.url === 'string' ? spec.url : typeof spec.href === 'string' ? spec.href : null);
      return { id: r.id, title: r.title, kind: r.kind, role: r.role ?? null, url, md: typeof spec.md === 'string' ? spec.md : null, taskId: Number(r.recordId) };
    })
    .sort((a, b) => a.id - b.id);
}

/**
 * The pack a release would carry, read from the records and written nowhere:
 * what `linkRelease` writes, and what the backfill prints on a dry run.
 * @param orgId - The workspace.
 * @param releaseId - The release record.
 * @returns The pack, or null when the release names no pull request.
 */
export async function buildReleasePack(orgId: string, releaseId: number): Promise<ReleasePack | null> {
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
  const requestIdOf = (t: Row) => {
    const n = Number(t.meta.requestId);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const wanted = new Set(tasks.map(requestIdOf).filter((id): id is number => id !== null));
  const requests = wanted.size === 0 ? [] : (await objectsOfType(orgId, 'request')).filter(r => wanted.has(r.id));
  const shippedIds = tasks.map(t => t.id);
  // ONE COUNT (`libs/workspace/featureProof.ts`): the work's own acceptance
  // lines, and the plan-risk lines as their own group, judged on the attempt
  // this release shipped — the count the feature's page shows.
  const proofOf = (requestId: number | null) => featureProof({
    request: requests.find(r => r.id === requestId) ?? null,
    tasks: tasks.filter(t => requestIdOf(t) === requestId),
    shippedTaskIds: shippedIds,
  });
  const artifacts = await proofArtifacts(orgId, tasks.map(t => t.id));
  const evidence: ReleaseEvidence[] = tasks.map((t) => {
    const v = (t.meta.verdict ?? {}) as { value?: string; proven?: number; total?: number };
    const requestId = requestIdOf(t);
    const proof = proofOf(requestId);
    const risks = risksLine(proof);
    const counted = proof.attempt !== null && proof.total > 0
      ? `${proof.proven} of ${proof.total} proven${risks ? ` · ${risks}` : ''}`
      : `${v.proven ?? 0} of ${v.total ?? 0} proven`;
    // The proof of the attempt that counts, paired to what it stored. Every
    // task of one request carries the same list: it is the feature's proof.
    const attemptId = proof.attempt?.taskId ?? t.id;
    return {
      taskId: t.id,
      requestId,
      prUrl: normalPr(String(t.meta.prUrl)),
      // Shipped without a verdict is said plainly, never dressed up.
      verdict: v.value ? `${v.value}, ${counted}` : 'merged without a QA verdict',
      // The feature's own words travel with the pack, so a release reads as
      // what it shipped even where the task is not loaded beside it.
      title: t.title,
      criteria: proof.attempt === null ? [] : criterionEvidence(proof, artifacts.filter(a => a.taskId === attemptId)),
    };
  });
  const taskIds = evidence.map(e => e.taskId);
  const requestIds = [...new Set(evidence.map(e => e.requestId).filter((id): id is number => id !== null))];
  // The one line the Releases row leads with: which features, and the proof.
  const titleOf = new Map(tasks.map(t => [t.id, t.title]));
  // "No linked feature" rather than "no factory feature": the deploy may have
  // shipped real changes no request stands behind, and the release's page
  // says what they were (`libs/workspace/releaseFeed.ts`).
  const shippedLine = evidence.length > 0
    ? evidence.map(e => `${titleOf.get(e.taskId) ?? `task #${e.taskId}`} — QA ${e.verdict}`).join('; ')
    : 'No linked feature';
  const releaseMeta = {
    shippedLine,
    prUrls: [...shipped, ...reverted],
    taskIds,
    requestIds,
    evidence,
    revertedPrUrls: reverted,
    // Every shot AND every named-test run: #223 stored its eight shots and
    // not the run that proved four of its six lines.
    verificationArtifactIds: artifacts.map(a => a.id),
  };
  const releasedAt = typeof meta.releasedAt === 'string' ? meta.releasedAt : new Date().toISOString();
  // THE CONTRACT HOLDS, SAID FROM QA'S PROOF. The Done row counts the
  // request's own acceptance lines as met or unmet, and nothing ever marked
  // them: #131 shipped at "QA approve, 8 of 8 proven" and read "6 of 6 unmet"
  // at the top of Done. Each line is paired by words with the shipped task's
  // verdict (`featureProof`); a proven line is met, with its evidence and the
  // link it names. A line QA did not prove stays as it was — that is the gate.
  // The feature page does not depend on this write: it reads the same proof
  // from the verdict (#126 read "0 of 6 verified" because this wrote
  // `evidence` and never `evidenceUrl`).
  const requestMeta: ReleasePack['requestMeta'] = [];
  for (const request of requests) {
    const acceptance = Array.isArray(request.meta.acceptance) ? request.meta.acceptance as Array<Record<string, unknown>> : [];
    const proof = proofOf(request.id);
    const judged = proof.attempt !== null && proof.acceptance.some(c => c.from === 'verdict');
    const marked = acceptance.map((a, i) => {
      const c = proof.acceptance[i];
      return c?.from === 'verdict' && c.state === 'passed'
        ? { ...a, met: true, evidence: c.evidence ?? `QA, release #${releaseId}`, ...(c.evidenceUrl ? { evidenceUrl: c.evidenceUrl } : {}), provenBy: { taskId: proof.attempt!.taskId, releaseId } }
        : a;
    });
    requestMeta.push({ id: request.id, set: { state: 'shipped', shippedAt: releasedAt, shippedIn: releaseId, ...(judged && acceptance.length > 0 ? { acceptance: marked } : {}) } });
  }
  return { requestIds, taskIds, evidence, reverted, releaseMeta, requestMeta };
}

/**
 * Link a release to what it shipped. Idempotent: running it again on the
 * same release writes the same pack.
 * @param orgId - The workspace.
 * @param releaseId - The release record.
 * @param opts - How the `release.linked` subscribers run.
 * @param opts.dispatchMode - `background` from a request, so the deploy's POST is not held open by the draft.
 * @returns The pack written, or null when the release names no pull request.
 */
export async function linkRelease(orgId: string, releaseId: number, opts: { dispatchMode?: 'inline' | 'background' } = {}): Promise<{ requestIds: number[]; taskIds: number[]; evidence: ReleaseEvidence[]; reverted: string[] } | null> {
  const pack = await buildReleasePack(orgId, releaseId);
  if (!pack) {
    return null;
  }
  const { requestIds, taskIds, evidence, reverted } = pack;
  await mergeMeta(orgId, releaseId, pack.releaseMeta);
  for (const r of pack.requestMeta) {
    await mergeMeta(orgId, r.id, r.set);
  }
  const { recomputeRollupsForObject } = await import('@/services/objects/rollups');
  await recomputeRollupsForObject(orgId, releaseId).catch(() => undefined);
  await announceWhatItCanSay(orgId, releaseId, { requestIds, taskIds }, opts.dispatchMode).catch((err) => {
    console.warn('[release] could not raise release.linked', { releaseId, error: (err as Error).message });
  });
  return { requestIds, taskIds, evidence, reverted };
}

/**
 * VOCION WRITES THE ANNOUNCEMENT. Once the pack is linked the release can be
 * said, so this reads it the one way every surface reads it
 * (`libs/workspace/releaseFeed.ts` `readRelease`) and says what follows:
 *
 * - Nothing people use changed — no linked feature, only internal or reverted
 *   changes — and there is nothing to announce: `announcementState:
 *   not-needed` is written here, in code, and no agent is woken to draft it.
 * - Otherwise `release.linked` is raised, and the software factory's product
 *   manager drafts the announcement from the pack (`release-announcement-draft`)
 *   as `notesSource: agent`, `announcementState: draft`. Publishing stays
 *   `release.announce`, a gated action a person decides.
 *
 * Deduped per release: a deploy that re-posts the same release drafts nothing twice.
 * @param orgId - The workspace.
 * @param releaseId - The release just linked.
 * @param ids - What the pack linked.
 * @param ids.requestIds - The requests it closes.
 * @param ids.taskIds - The tasks it shipped.
 * @param dispatchMode - How the subscribers run.
 */
async function announceWhatItCanSay(orgId: string, releaseId: number, ids: { requestIds: number[]; taskIds: number[] }, dispatchMode?: 'inline' | 'background'): Promise<void> {
  const { loadReleaseLinked, loadReleaseRow } = await import('./releaseData');
  const { readRelease } = await import('@/libs/workspace/releaseFeed');
  const row = await loadReleaseRow(orgId, releaseId);
  if (!row) {
    return;
  }
  const reading = readRelease(row, { linked: await loadReleaseLinked(orgId, [row]) });
  const state = reading.announcement.state;
  if (state === 'not-needed' && row.meta.announcementState !== 'not-needed') {
    await mergeMeta(orgId, releaseId, { announcementState: 'not-needed' });
  }
  const { emitEvent, RELEASE_LINKED } = await import('@/services/EventService');
  const payload: import('@/services/EventService').ReleaseLinkedPayload = {
    releaseId,
    product: reading.productSlug,
    userFacing: reading.userFacing,
    features: reading.features.length,
    internal: reading.internal.length,
    announcementState: state,
    requestIds: ids.requestIds,
    taskIds: ids.taskIds,
  };
  await emitEvent({ orgId, type: RELEASE_LINKED, payload, dedupeKey: `release.linked:${releaseId}`, invokedBy: 'factory:release-pack', ...(dispatchMode ? { dispatchMode } : {}) });
}

export type RelinkReport = {
  mode: 'dry-run' | 'apply';
  releaseId: number;
  /** False when the release names no pull request, so there is nothing to link. */
  linked: boolean;
  /** Per feature: each criterion and the artifact that proves it. */
  features: Array<{ title: string; taskId: number; criteria: CriterionEvidence[] }>;
  verificationArtifactIds: number[];
  /** The drafted announcement with its internal sentences taken out (never a person's words). */
  announcement: { before: string; after: string; dropped: string[] } | null;
};

/**
 * RE-LINK ONE RELEASE through the same path a deploy takes (`linkRelease`),
 * for a release linked before its pack carried the proof. A dry run unless
 * `apply`: it reports the pack it would write and writes nothing. Idempotent:
 * applied twice, the second run writes what the first did, and the
 * `release.linked` it raises is deduped per release, so nobody is woken again.
 *
 * It also takes the internal sentences out of an agent's drafted
 * announcement ("QA proved 6 of 6 criteria") — the gate that refuses them
 * came after the draft. Words a person owns (`notesSource: human`) and an
 * announcement already published are left exactly as they are.
 * @param orgId - The workspace.
 * @param releaseId - The release.
 * @param opts - What to do.
 * @param opts.apply - Write the pack; otherwise only report it.
 */
export async function relinkRelease(orgId: string, releaseId: number, opts: { apply?: boolean } = {}): Promise<RelinkReport> {
  const { plainAnnouncement } = await import('@/libs/workspace/releaseFeed');
  const [row] = await db
    .select({ meta: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, releaseId)))
    .limit(1);
  const meta = (row?.meta ?? {}) as Record<string, unknown>;
  const pack = await buildReleasePack(orgId, releaseId);
  const text = typeof meta.announcement === 'string' ? meta.announcement : null;
  const plain = text !== null && meta.notesSource !== 'human' && typeof meta.announcedAt !== 'string' ? plainAnnouncement(text) : null;
  const announcement = text !== null && plain && plain.dropped.length > 0 && plain.text !== '' ? { before: text, after: plain.text, dropped: plain.dropped } : null;
  const report: RelinkReport = {
    mode: opts.apply ? 'apply' : 'dry-run',
    releaseId,
    linked: pack !== null,
    features: (pack?.evidence ?? []).map(e => ({ title: e.title, taskId: e.taskId, criteria: e.criteria })),
    verificationArtifactIds: Array.isArray(pack?.releaseMeta.verificationArtifactIds) ? pack.releaseMeta.verificationArtifactIds as number[] : [],
    announcement,
  };
  if (!opts.apply) {
    return report;
  }
  if (pack) {
    await linkRelease(orgId, releaseId, { dispatchMode: 'inline' });
  }
  if (announcement) {
    await mergeMeta(orgId, releaseId, { announcement: announcement.after });
  }
  return report;
}
