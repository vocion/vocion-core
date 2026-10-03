/**
 * PUBLISH A RECORDING TO THE VIDEO HOST: read a filed recording's bytes from
 * the media store, upload them to the org's video host once, and keep the
 * share on every artifact that carries the same file.
 *
 * Rules, each one a test:
 *
 *   - **No host, nothing.** An org with no host connected is skipped without
 *     a write.
 *   - **Once per file.** A recording is filed as several artifacts (the
 *     feature request, and the task or release beside it), all pointing at
 *     the same served URL. One of them is claimed (`hostedVideo.state =
 *     publishing`, a conditional write) before the upload; a sibling already
 *     published hands its share to the rest without a second upload.
 *   - **Narrated first.** A narrated recording (role `<role>-narrated`) is the
 *     one a person should watch. A raw recording whose narrated twin was filed
 *     after it on the same record is not uploaded: the twin is published in
 *     its place (once — its own claim holds), however the twin was filed.
 *   - **Never blocks, never silent.** Nothing here throws to the caller. A
 *     refusal is kept on the artifacts (`hostedVideo.state = failed`, its
 *     reason, the attempt count), where the feature page reads it, and comes
 *     back with whether trying again could help — the job retries those.
 */

import type { Buffer } from 'node:buffer';
import type { VideoHost } from './host';

/** The role a narrated recording is filed under: its raw recording's role and this suffix. */
export const NARRATED_ROLE_SUFFIX = '-narrated';

/** A claim older than this is a publisher that died; it may be taken again. */
export const STALE_CLAIM_MS = 30 * 60_000;

export function isNarratedRole(role: string | null | undefined): boolean {
  return typeof role === 'string' && role.endsWith(NARRATED_ROLE_SUFFIX);
}

/** The slice of an artifact this needs. */
export type RecordingArtifact = {
  id: number;
  kind: string;
  title: string;
  url: string | null;
  spec: Record<string, unknown>;
  recordId: string | null;
  recordRole: string | null;
  createdAt: Date;
};

export type HostedVideo = NonNullable<import('@/libs/cards/specs').FileSpec['hostedVideo']>;

export type PublishStore = {
  get: (orgId: string, id: number) => Promise<RecordingArtifact | null>;
  /** Every file artifact in the org carrying this served URL, oldest first. */
  siblings: (orgId: string, url: string) => Promise<RecordingArtifact[]>;
  /** Mark `id` as being published, only when nobody holds a live claim and it is not published. True when claimed. */
  claim: (orgId: string, id: number, claim: HostedVideo, staleBefore: Date) => Promise<boolean>;
  /** Merge `hostedVideo` into each artifact's spec without a new version (a state, not an edit). */
  note: (orgId: string, ids: number[], hostedVideo: HostedVideo) => Promise<void>;
  /** Keep the share on an artifact as a new version, so its history shows where it went. */
  share: (orgId: string, artifact: RecordingArtifact, fields: Record<string, unknown>) => Promise<void>;
  readBytes: (orgId: string, url: string) => Promise<Buffer | null>;
  codeFor: (orgId: string, recordId: number) => Promise<string | null>;
  /** The newest narrated recording filed on this record under the narrated twin of a role, at or after `since`, or null. */
  narratedTwin: (orgId: string, recordId: string, narratedRole: string, since: Date) => Promise<number | null>;
};

export type PublishOutcome
  = | { status: 'no-host' }
    | { status: 'skipped'; reason: string }
    | { status: 'in-progress' }
    | { status: 'already'; shareId: string; copiedTo: number[] }
    | { status: 'published'; shareId: string; watchUrl: string; artifactIds: number[] }
    | { status: 'failed'; reason: string; retryable: boolean };

function contentTypeOf(a: RecordingArtifact): string {
  return typeof a.spec.contentType === 'string' ? a.spec.contentType : 'video/webm';
}

function hostedOf(a: RecordingArtifact): HostedVideo | null {
  const h = a.spec.hostedVideo;
  return h && typeof h === 'object' && typeof (h as HostedVideo).state === 'string' ? h as HostedVideo : null;
}

/**
 * Publish one filed recording. Never throws.
 * @param input - Which recording.
 * @param input.orgId - The workspace.
 * @param input.artifactId - One of the artifacts the recording was filed as.
 * @param deps - The host and the store; both resolved from the app when absent.
 * @param deps.host - The video host, or null for none; looked up when undefined.
 * @param deps.store - Reads and writes.
 * @param deps.now - The clock.
 */
export async function publishRecording(input: { orgId: string; artifactId: number }, deps: { host?: VideoHost | null; store?: PublishStore; now?: () => Date } = {}): Promise<PublishOutcome> {
  const now = deps.now ?? (() => new Date());
  try {
    const host = deps.host === undefined ? await (await import('./host')).videoHost(input.orgId) : deps.host;
    if (!host) {
      return { status: 'no-host' };
    }
    const store = deps.store ?? await defaultStore();
    const artifact = await store.get(input.orgId, input.artifactId);
    if (!artifact || artifact.kind !== 'file' || !artifact.url || !contentTypeOf(artifact).startsWith('video/')) {
      return { status: 'skipped', reason: `artifact #${input.artifactId} is not a kept recording` };
    }
    // A raw recording whose narrated twin landed after it: the twin is the one
    // a person should watch, so it is published in this one's place.
    if (artifact.recordId && artifact.recordRole && !isNarratedRole(artifact.recordRole)) {
      const twin = await store.narratedTwin(input.orgId, artifact.recordId, `${artifact.recordRole}${NARRATED_ROLE_SUFFIX}`, artifact.createdAt);
      if (twin !== null && twin !== artifact.id) {
        return publishRecording({ orgId: input.orgId, artifactId: twin }, { ...deps, host, store });
      }
    }
    const siblings = await store.siblings(input.orgId, artifact.url);
    const all = siblings.some(s => s.id === artifact.id) ? siblings : [artifact, ...siblings];
    const done = all.find(s => hostedOf(s)?.state === 'published' && hostedOf(s)?.shareId);
    if (done) {
      const hosted = hostedOf(done)!;
      const missing = all.filter(s => hostedOf(s)?.state !== 'published');
      const fields = { ...host.specFields(hosted.shareId!), hostedVideo: hosted };
      for (const s of missing) {
        await store.share(input.orgId, s, fields);
      }
      return { status: 'already', shareId: hosted.shareId!, copiedTo: missing.map(s => s.id) };
    }
    const owner = all.reduce((a, b) => (a.id <= b.id ? a : b));
    const prior = hostedOf(owner);
    const attempts = (prior?.attempts ?? 0) + 1;
    const claimed = await store.claim(input.orgId, owner.id, { state: 'publishing', host: host.id, label: host.label, attempts, at: now().toISOString() }, new Date(now().getTime() - STALE_CLAIM_MS));
    if (!claimed) {
      return { status: 'in-progress' };
    }
    const fail = async (reason: string, retryable: boolean): Promise<PublishOutcome> => {
      await store.note(input.orgId, all.map(s => s.id), { state: 'failed', host: host.id, label: host.label, reason: reason.slice(0, 500), attempts, at: now().toISOString() });
      return { status: 'failed', reason, retryable };
    };
    const data = await store.readBytes(input.orgId, artifact.url);
    if (!data) {
      return fail(`the recording's file could not be read from the media store (${artifact.url}).`, false);
    }
    const recordId = Number(artifact.recordId);
    const code = Number.isInteger(recordId) && recordId > 0 ? await store.codeFor(input.orgId, recordId).catch(() => null) : null;
    const caption = typeof artifact.spec.caption === 'string' ? artifact.spec.caption : artifact.title;
    const title = code && !artifact.title.includes(code) ? `${code} · ${artifact.title}` : artifact.title;
    const published = await host.publish({ data, contentType: contentTypeOf(artifact), title, summary: caption });
    if (!published.ok) {
      return fail(published.reason, published.retryable);
    }
    const hosted: HostedVideo = {
      state: 'published',
      host: host.id,
      label: host.label,
      shareId: published.shareId,
      hostRef: published.hostRef,
      watchUrl: published.watchUrl,
      embedUrl: published.embedUrl,
      visibility: published.visibility,
      attempts,
      at: now().toISOString(),
    };
    for (const s of all) {
      await store.share(input.orgId, s, { ...host.specFields(published.shareId), hostedVideo: hosted });
    }
    return { status: 'published', shareId: published.shareId, watchUrl: published.watchUrl, artifactIds: all.map(s => s.id) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    try {
      const { logger } = await import('@/libs/Logger');
      logger.warn('recording not published to the video host', { orgId: input.orgId, artifactId: input.artifactId, error: reason });
    } catch { /* logging is best effort */ }
    return { status: 'failed', reason, retryable: true };
  }
}

/** The store over the app's database, artifact service and media store. */
async function defaultStore(): Promise<PublishStore> {
  const { and, asc, desc, eq, gte, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { artifactSchema } = await import('@/models/Schema');
  const columns = {
    id: artifactSchema.id,
    kind: artifactSchema.kind,
    title: artifactSchema.title,
    url: artifactSchema.url,
    spec: artifactSchema.spec,
    recordId: artifactSchema.recordId,
    recordRole: artifactSchema.recordRole,
    createdAt: artifactSchema.createdAt,
  };
  return {
    async get(orgId, id) {
      const [row] = await db.select(columns).from(artifactSchema).where(and(eq(artifactSchema.orgId, orgId), eq(artifactSchema.id, id))).limit(1);
      return row ?? null;
    },
    async siblings(orgId, url) {
      return db.select(columns).from(artifactSchema).where(and(eq(artifactSchema.orgId, orgId), eq(artifactSchema.kind, 'file'), eq(artifactSchema.url, url))).orderBy(asc(artifactSchema.id)).limit(50);
    },
    async claim(orgId, id, claim, staleBefore) {
      const rows = await db.update(artifactSchema)
        .set({ spec: sql`${artifactSchema.spec} || jsonb_build_object('hostedVideo', ${JSON.stringify(claim)}::jsonb)` })
        .where(and(
          eq(artifactSchema.orgId, orgId),
          eq(artifactSchema.id, id),
          sql`(${artifactSchema.spec} -> 'hostedVideo' IS NULL
            OR ${artifactSchema.spec} -> 'hostedVideo' ->> 'state' = 'failed'
            OR (${artifactSchema.spec} -> 'hostedVideo' ->> 'state' = 'publishing' AND ${artifactSchema.spec} -> 'hostedVideo' ->> 'at' < ${staleBefore.toISOString()}))`,
        ))
        .returning({ id: artifactSchema.id });
      return rows.length > 0;
    },
    async note(orgId, ids, hostedVideo) {
      for (const id of ids) {
        await db.update(artifactSchema)
          .set({ spec: sql`${artifactSchema.spec} || jsonb_build_object('hostedVideo', ${JSON.stringify(hostedVideo)}::jsonb)` })
          .where(and(eq(artifactSchema.orgId, orgId), eq(artifactSchema.id, id)));
      }
    },
    async share(orgId, artifact, fields) {
      const { getArtifact, updateArtifact } = await import('@/services/ArtifactService');
      const current = await getArtifact({ orgId, id: artifact.id });
      if (!current) {
        return;
      }
      const label = (fields.hostedVideo as HostedVideo | undefined)?.label ?? 'the video host';
      await updateArtifact({ orgId, id: artifact.id, spec: { ...current.spec, ...fields }, author: { kind: 'system', id: 'video-host' }, changeSummary: `Published to ${label}` });
    },
    async readBytes(orgId, url) {
      const { readMediaBytes } = await import('@/libs/tools/artifacts/media');
      return readMediaBytes(orgId, url);
    },
    async codeFor(orgId, recordId) {
      const { codeForRecord } = await import('@/services/codes');
      return codeForRecord(orgId, recordId);
    },
    async narratedTwin(orgId, recordId, narratedRole, since) {
      const [row] = await db.select({ id: artifactSchema.id }).from(artifactSchema).where(and(
        eq(artifactSchema.orgId, orgId),
        eq(artifactSchema.recordType, 'object'),
        eq(artifactSchema.recordId, recordId),
        eq(artifactSchema.recordRole, narratedRole),
        gte(artifactSchema.createdAt, since),
      )).orderBy(desc(artifactSchema.createdAt)).limit(1);
      return row?.id ?? null;
    },
  };
}
