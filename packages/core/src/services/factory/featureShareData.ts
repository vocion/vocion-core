/**
 * The tables half of a feature's public page (`featureShare.ts` is the pure
 * half): filing and revoking the link, reading the page for a token, and
 * deciding whether one file may be served through it.
 *
 * Every read is scoped by the org the TOKEN names, and every answer for a
 * bad, tampered or revoked token is the same null — the routes turn it into
 * the same 404, so a visitor learns nothing about what exists.
 */

import type { PublicFeaturePage, SharedArtifact } from './featureShare';
import type { ArtifactRow } from '@/services/ArtifactService';
import type { VideoAudience, VideoHost } from '@/services/videoHost/host';
import { factoryTypes } from '@/libs/factory/types';
import { signArtifactShare, signShareMedia, verifyArtifactShare, verifyShareMedia } from '@/libs/share/artifactShareToken';
import { createArtifact, getArtifact, listArtifactsByIds, listArtifactsForRecord, listArtifactsForRecords, setArtifactShare, updateArtifact } from '@/services/ArtifactService';
import { getBusinessObject } from '@/services/BusinessObjectService';
import { codeForRecord } from '@/services/codes';
import { recordHref } from '@/services/objects/recordHref';
import { nameOnRead } from '@/services/objects/recordName';
import { setRecordingsAudience } from '@/services/videoHost/audience';
import { loadFeatureReport } from './featureReportData';
import { FEATURE_PAGE_ROLE, HIDE_ASKER, HIDE_OPEN_LINK, publicFeaturePage, QA_SHOT_ROLE, WALKTHROUGH_ROLES } from './featureShare';

/** Every role a file filed on the feature or its attempts may be served under: the recordings and QA's screenshots. */
const FILED_ROLES: readonly string[] = [...WALKTHROUGH_ROLES, QA_SHOT_ROLE];

/** What the Share control shows. */
export type FeatureShareState = {
  shared: boolean;
  /** The public path (`/share/feature/<token>`) while shared. */
  path: string | null;
  hideAsker: boolean;
  /** The page's "Open in <workspace>" button; on unless the sharer turned it off. */
  showOpenLink: boolean;
};

const OFF: FeatureShareState = { shared: false, path: null, hideAsker: false, showOpenLink: true };

/**
 * The public path for a link artifact.
 * @param row - The link.
 * @param row.id - Its id.
 * @param row.orgId - Its workspace.
 */
export function featureSharePath(row: { id: number; orgId: string }): string {
  return `/share/feature/${signArtifactShare({ artifactId: row.id, orgId: row.orgId })}`;
}

function hiddenOf(row: Pick<ArtifactRow, 'spec'>): string[] {
  const h = (row.spec as Record<string, unknown>).hidden;
  return Array.isArray(h) ? h.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Whether an artifact is a feature's public link, shared with anyone right now.
 * @param row - The artifact.
 */
function isLiveLink(row: Pick<ArtifactRow, 'recordRole' | 'recordType' | 'recordId' | 'shareAudience'>): boolean {
  return row.recordRole === FEATURE_PAGE_ROLE && row.recordType === 'object' && /^\d+$/.test(row.recordId ?? '') && row.shareAudience === 'anyone';
}

function stateOf(row: ArtifactRow | null): FeatureShareState {
  return row ? { shared: true, path: featureSharePath(row), hideAsker: hiddenOf(row).includes(HIDE_ASKER), showOpenLink: !hiddenOf(row).includes(HIDE_OPEN_LINK) } : OFF;
}

/**
 * The live link on a request, newest first, or null.
 * @param orgId - Tenant.
 * @param requestId - The request.
 */
async function liveLink(orgId: string, requestId: number): Promise<ArtifactRow | null> {
  const rows = await listArtifactsForRecord({ orgId, record: { type: 'object', id: String(requestId) } });
  return rows.filter(isLiveLink).sort((a, b) => b.id - a.id)[0] ?? null;
}

/**
 * The request, when it is one of this workspace's features.
 * @param orgId - Tenant.
 * @param requestId - The record.
 */
async function featureRow(orgId: string, requestId: number) {
  const [row, types] = await Promise.all([getBusinessObject(requestId, orgId), factoryTypes(orgId)]);
  return row && row.type?.slug === types.request ? row : null;
}

/**
 * Whether this feature is public, and its link.
 * @param orgId - Tenant.
 * @param requestId - The request.
 */
export async function featureShareOf(orgId: string, requestId: number): Promise<FeatureShareState> {
  return stateOf(await liveLink(orgId, requestId));
}

/**
 * Share a feature, stop sharing it, or change what its page leaves out. A
 * person's own act, run as they said it: nothing asks them twice, and Stop
 * sharing is the undo. Sharing again after a stop files a NEW link, so a
 * copy of the old one stays dead. Null when the workspace has no such feature.
 * @param opts
 * @param opts.orgId - Tenant.
 * @param opts.requestId - The request.
 * @param opts.userId - Who pressed it: the link's author.
 * @param opts.shared - On or off.
 * @param opts.hideAsker - Leave out who asked. Absent, unchanged (a new link shows them).
 * @param opts.showOpenLink - Show the "Open in <workspace>" button. Absent, unchanged (a new link shows it).
 * @param deps - Seams for tests.
 * @param deps.host - The video host, or null for none; looked up when undefined.
 *
 * The recordings the page shows follow it on their video host: `public` while
 * the link is live, the workspace's choice after ({@link followShare}).
 */
export async function setFeatureShare(opts: SetFeatureShareInput, deps: { host?: VideoHost | null } = {}): Promise<FeatureShareState | null> {
  const state = await writeLink(opts);
  if (state) {
    await followShare(opts.orgId, opts.requestId, state.shared ? 'public' : 'workspace', deps);
  }
  return state;
}

type SetFeatureShareInput = { orgId: string; requestId: number; userId: string | null; shared: boolean; hideAsker?: boolean; showOpenLink?: boolean };

/**
 * The link half of {@link setFeatureShare}.
 * @param opts - As there.
 */
async function writeLink(opts: SetFeatureShareInput): Promise<FeatureShareState | null> {
  const row = await featureRow(opts.orgId, opts.requestId);
  if (!row) {
    return null;
  }
  const live = await liveLink(opts.orgId, opts.requestId);
  const author = { kind: 'human' as const, id: opts.userId };
  if (!opts.shared) {
    const rows = await listArtifactsForRecord({ orgId: opts.orgId, record: { type: 'object', id: String(opts.requestId) } });
    for (const link of rows.filter(isLiveLink)) {
      await setArtifactShare({ orgId: opts.orgId, id: link.id, audience: 'workspace', userId: opts.userId });
    }
    return OFF;
  }
  const was = live ? hiddenOf(live) : [];
  const hideAsker = opts.hideAsker ?? was.includes(HIDE_ASKER);
  const hideOpen = opts.showOpenLink === undefined ? was.includes(HIDE_OPEN_LINK) : !opts.showOpenLink;
  const hidden = [...(hideAsker ? [HIDE_ASKER] : []), ...(hideOpen ? [HIDE_OPEN_LINK] : [])];
  const title = row.title;
  if (live) {
    const askerChanged = hideAsker !== was.includes(HIDE_ASKER);
    const openChanged = hideOpen !== was.includes(HIDE_OPEN_LINK);
    if (!askerChanged && !openChanged) {
      return stateOf(live);
    }
    const { artifact } = await updateArtifact({
      orgId: opts.orgId,
      id: live.id,
      spec: { ...(live.spec as Record<string, unknown>), hidden },
      author,
      changeSummary: askerChanged ? (hideAsker ? 'Hid who asked' : 'Showed who asked') : (hideOpen ? 'Hid the Open button' : 'Showed the Open button'),
      noCollapse: true,
    });
    return stateOf(artifact);
  }
  const { artifact } = await createArtifact({
    orgId: opts.orgId,
    kind: 'link',
    title: `Public page · ${title}`,
    spec: { href: '/share/feature', title, description: 'A read-only page anyone with the link can open.', hidden },
    record: { type: 'object', id: String(opts.requestId), role: FEATURE_PAGE_ROLE },
    author,
    changeSummary: 'Shared publicly',
    // The link is the feature page's to show; it is not a deliverable for the library.
    visibility: 'system',
  });
  const widened = await setArtifactShare({ orgId: opts.orgId, id: artifact.id, audience: 'anyone', userId: opts.userId });
  if (!widened) {
    return OFF;
  }
  // The card's own link is the public page, once the id that signs it exists.
  const { artifact: linked } = await updateArtifact({
    orgId: opts.orgId,
    id: widened.id,
    spec: { ...(widened.spec as Record<string, unknown>), href: featureSharePath(widened) },
    author,
    changeSummary: 'Shared publicly',
  });
  return stateOf({ ...linked, shareAudience: 'anyone' });
}

/** How long Share waits for the video host before answering; the change carries on after. */
export const SHARE_AUDIENCE_BUDGET_MS = 5_000;

/**
 * The recordings a feature's page can show: the walkthroughs filed on the
 * request and on any record that names it as its request (its tasks).
 * @param orgId - Tenant.
 * @param requestId - The request.
 */
async function recordingsOf(orgId: string, requestId: number): Promise<ArtifactRow[]> {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  const children = await db.select({ id: businessObjectSchema.id }).from(businessObjectSchema).where(and(
    eq(businessObjectSchema.orgId, orgId),
    sql`${businessObjectSchema.metadata} ->> 'requestId' = ${String(requestId)}`,
  ));
  const rows = await listArtifactsForRecords({ orgId, recordType: 'object', recordIds: [requestId, ...children.map(c => c.id)].map(String) });
  return rows.filter(a => (WALKTHROUGH_ROLES as readonly string[]).includes(a.recordRole ?? ''));
}

/**
 * Bring who may watch the page's hosted recordings in line with the link.
 * Never throws and never holds Share up for longer than
 * {@link SHARE_AUDIENCE_BUDGET_MS}: a host that is down leaves its reason on
 * the recordings, and the page plays Vocion's own copy until a later Share
 * (or a recording landing) tries again.
 * @param orgId - Tenant.
 * @param requestId - The request.
 * @param audience - `public` while shared.
 * @param deps - Seams for tests.
 * @param deps.host - The video host, or null for none; looked up when undefined.
 */
export async function followShare(orgId: string, requestId: number, audience: VideoAudience, deps: { host?: VideoHost | null } = {}): Promise<void> {
  const work = (async () => {
    try {
      const recordings = await recordingsOf(orgId, requestId);
      await setRecordingsAudience({ orgId, recordings, audience }, deps);
    } catch (err) {
      const { logger } = await import('@/libs/Logger');
      logger.warn('shared feature recordings not brought in line with the link', { orgId, requestId, audience, error: err instanceof Error ? err.message : String(err) });
    }
  })().catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SHARE_AUDIENCE_BUDGET_MS);
  })]);
  clearTimeout(timer);
}

/**
 * Whether any of these records is a feature with a live public link, or names
 * one as its request (a task): what a recording filed on them goes up as.
 * @param orgId - Tenant.
 * @param recordIds - The records a recording is filed on.
 */
export async function publicLinkLiveFor(orgId: string, recordIds: string[]): Promise<boolean> {
  for (const raw of recordIds) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      continue;
    }
    if (await liveLink(orgId, id)) {
      return true;
    }
    const row = await getBusinessObject(id, orgId);
    const parent = Number(((row?.metadata ?? {}) as Record<string, unknown>).requestId);
    if (Number.isInteger(parent) && parent > 0 && parent !== id && await liveLink(orgId, parent)) {
      return true;
    }
  }
  return false;
}

/**
 * The link a token names, while it is live.
 * @param token
 */
async function linkFor(token: string): Promise<{ orgId: string; link: ArtifactRow; requestId: number } | null> {
  const claim = verifyArtifactShare(token);
  if (!claim) {
    return null;
  }
  const link = await getArtifact({ orgId: claim.orgId, id: claim.artifactId });
  if (!link || link.orgId !== claim.orgId || !isLiveLink(link)) {
    return null;
  }
  return { orgId: claim.orgId, link, requestId: Number(link.recordId) };
}

/**
 * The workspace's display name — its project row's — for "Built by …" on the
 * page and the site a pasted link unfurls under. Null when it cannot be read.
 * @param orgId - The workspace.
 */
async function workspaceNameOf(orgId: string): Promise<string | null> {
  const { eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { projectSchema } = await import('@/models/Schema');
  const [row] = await db.select({ name: projectSchema.name }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  return row?.name?.trim() || null;
}

function toShared(a: ArtifactRow): SharedArtifact {
  return { id: a.id, kind: a.kind, title: a.title, url: a.url ?? null, spec: (a.spec ?? {}) as Record<string, unknown>, recordRole: a.recordRole ?? null, recordId: a.recordId ?? null, createdAt: a.createdAt, shareAudience: a.shareAudience };
}

function visualIds(meta: Record<string, unknown>): number[] {
  const visuals = (meta.visuals ?? {}) as Record<string, unknown>;
  return ['mockupArtifactIds', 'beforeArtifactIds', 'afterArtifactIds']
    .flatMap(k => (Array.isArray(visuals[k]) ? visuals[k] as unknown[] : []))
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0);
}

/**
 * The public page for a token, or null for a bad, tampered or revoked one.
 * @param token - From the URL.
 * @param now - The clock.
 */
export async function loadSharedFeature(token: string, now: Date = new Date()): Promise<PublicFeaturePage | null> {
  const found = await linkFor(token);
  if (!found) {
    return null;
  }
  const { orgId, link, requestId } = found;
  const [report, row] = await Promise.all([loadFeatureReport(orgId, requestId, now), getBusinessObject(requestId, orgId)]);
  if (!report || !row) {
    return null;
  }
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const taskIds = report.implementation.attempts.map(a => a.taskId).filter((n): n is number => n !== null);
  const pictureIds = visualIds(meta);
  const [pictures, onRecords] = await Promise.all([
    pictureIds.length === 0 ? Promise.resolve([]) : listArtifactsByIds({ orgId, ids: pictureIds }),
    listArtifactsForRecords({ orgId, recordType: 'object', recordIds: [...new Set([requestId, ...taskIds])].map(String) }),
  ]);
  // A feature filed with the whole ask as its title is named the first time
  // its page is read, and the name is kept (`services/objects/recordName.ts`).
  const hidden = hiddenOf(link);
  const product = typeof meta.product === 'string' ? meta.product : null;
  const [name, code, workspaceName, openUrl, productName] = await Promise.all([
    nameOnRead({ orgId, id: requestId, title: row.title, meta, kind: row.type?.label?.toLowerCase() }),
    codeForRecord(orgId, requestId).catch(() => null),
    workspaceNameOf(orgId).catch(() => null),
    // The feature's own page in the app, the way the app links it: a visitor
    // without a session signs in, one outside the workspace is refused there.
    hidden.includes(HIDE_OPEN_LINK) ? Promise.resolve(null) : recordHref(orgId, { objectType: row.type?.slug ?? null, id: requestId }).catch(() => null),
    // The product's name, read the way the factory reads its product record.
    product ? import('@/libs/actions/factory-dispatch').then(m => m.readProduct(orgId, product)).then(p => p?.title ?? null).catch(() => null) : Promise.resolve(null),
  ]);
  return publicFeaturePage({
    report,
    request: { title: row.title, createdAt: row.createdAt ?? null, meta },
    name,
    code,
    workspaceName,
    openUrl,
    productName,
    pictures: pictures.map(toShared),
    recordings: onRecords.filter(a => (WALKTHROUGH_ROLES as readonly string[]).includes(a.recordRole ?? '')).map(toShared),
    evidence: onRecords.filter(a => a.recordRole === QA_SHOT_ROLE && a.recordId !== String(requestId)).map(toShared),
    hideAsker: hidden.includes(HIDE_ASKER),
    mediaSrc: artifactId => `/api/share/feature/${encodeURIComponent(token)}/media/${artifactId}?k=${signShareMedia({ shareId: link.id, artifactId })}`,
  });
}

/**
 * The one file a shared feature's page may load, or null. All of: the link
 * is live; the page signed this file for this link; the file is in the same
 * workspace and not narrowed to "Only me"; and it belongs to the feature —
 * one of the request's own pictures, or a recording or QA screenshot filed
 * on the request or on one of its tasks. Any one missing is the same null.
 * @param token - The link's token.
 * @param artifactId - The file.
 * @param sig - The page's signature for it.
 */
export async function sharedFeatureMedia(token: string, artifactId: number, sig: string): Promise<{ orgId: string; artifact: ArtifactRow } | null> {
  const found = await linkFor(token);
  if (!found || !verifyShareMedia(sig, { shareId: found.link.id, artifactId })) {
    return null;
  }
  const { orgId, requestId } = found;
  const artifact = await getArtifact({ orgId, id: artifactId });
  if (!artifact || artifact.orgId !== orgId || artifact.shareAudience === 'me') {
    return null;
  }
  const row = await getBusinessObject(requestId, orgId);
  if (!row) {
    return null;
  }
  if (visualIds((row.metadata ?? {}) as Record<string, unknown>).includes(artifact.id)) {
    return { orgId, artifact };
  }
  if (!FILED_ROLES.includes(artifact.recordRole ?? '') || artifact.recordType !== 'object') {
    return null;
  }
  const filedOn = Number(artifact.recordId);
  if (filedOn === requestId) {
    return { orgId, artifact };
  }
  const task = Number.isInteger(filedOn) && filedOn > 0 ? await getBusinessObject(filedOn, orgId) : null;
  const taskOf = Number(((task?.metadata ?? {}) as Record<string, unknown>).requestId);
  return task && taskOf === requestId ? { orgId, artifact } : null;
}
