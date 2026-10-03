/**
 * WHO MAY WATCH A HOSTED RECORDING follows the page that shows it: a
 * recording on a feature shared publicly is `public` on its video host, and
 * goes back to the workspace's choice when the link is turned off — so the
 * host's player plays for a stranger exactly while the page is theirs to see.
 *
 * Rules, each one a test:
 *
 *   - **Once per recording.** A recording is filed as several artifacts; the
 *     host is asked once per host id (`hostRef`) and the answer is kept on
 *     every artifact carrying it (`hostedVideo.visibility`).
 *   - **Only what needs it.** A recording already where it should be is not
 *     touched; one whose last change failed is tried again.
 *   - **Never blocks, never silent.** Nothing here throws. A host that is
 *     down or refuses leaves its reason on the artifacts
 *     (`hostedVideo.visibilityError`) and in the log; the page, reading a
 *     visibility that is not public, plays Vocion's own copy instead.
 */

import type { VideoAudience, VideoHost } from './host';
import type { HostedVideo } from './publish';
import { PUBLIC_VISIBILITY } from './host';

/** What a change of who may watch keeps on the artifacts: the visibility now, or why it did not change. */
export type VisibilityPatch = { visibility: string } | { visibilityError: string };

export type AudienceStore = {
  /** Merge the patch into `hostedVideo` on every artifact in the org carrying this host's recording. */
  noteVisibility: (orgId: string, hostId: string, hostRef: string, patch: VisibilityPatch) => Promise<void>;
};

export type AudienceOutcome = {
  /** Host ids now at the audience asked for. */
  changed: string[];
  /** Host ids that could not be changed, with why. */
  failed: Array<{ hostRef: string; reason: string }>;
};

function hostedOf(spec: Record<string, unknown> | null | undefined): HostedVideo | null {
  const h = spec?.hostedVideo;
  return h && typeof h === 'object' && typeof (h as HostedVideo).state === 'string' ? h as HostedVideo : null;
}

/**
 * Whether a recording's host lets anyone with the link watch it, as last recorded.
 * @param spec - The artifact's spec.
 */
export function isPubliclyHosted(spec: Record<string, unknown> | null | undefined): boolean {
  const h = hostedOf(spec);
  return h?.state === 'published' && h.visibility === PUBLIC_VISIBILITY;
}

async function warn(message: string, fields: Record<string, unknown>): Promise<void> {
  try {
    const { logger } = await import('@/libs/Logger');
    logger.warn(message, fields);
  } catch { /* logging is best effort */ }
}

/**
 * Set who may watch each hosted recording among `recordings`. Never throws.
 * @param input - Which recordings, and for whom.
 * @param input.orgId - The workspace.
 * @param input.recordings - The artifacts (only their specs are read); ones not published to a host are ignored.
 * @param input.audience - `public` while the page is shared, `workspace` after.
 * @param deps - The host and the store; resolved from the app when absent.
 * @param deps.host - The video host, or null for none; looked up when undefined.
 * @param deps.store - Writes.
 */
export async function setRecordingsAudience(
  input: { orgId: string; recordings: Array<{ spec: Record<string, unknown> | null }>; audience: VideoAudience },
  deps: { host?: VideoHost | null; store?: AudienceStore } = {},
): Promise<AudienceOutcome> {
  const outcome: AudienceOutcome = { changed: [], failed: [] };
  try {
    const byRef = new Map<string, HostedVideo>();
    for (const r of input.recordings) {
      const h = hostedOf(r.spec);
      if (h?.state === 'published' && h.hostRef && !byRef.has(h.hostRef)) {
        byRef.set(h.hostRef, h);
      }
    }
    const due = [...byRef.values()].filter((h) => {
      const isPublic = h.visibility === PUBLIC_VISIBILITY;
      return Boolean(h.visibilityError) || (input.audience === 'public' ? !isPublic : isPublic);
    });
    if (due.length === 0) {
      return outcome;
    }
    const store = deps.store ?? await defaultStore();
    const host = deps.host === undefined ? await (await import('./host')).videoHost(input.orgId) : deps.host;
    const fail = async (h: HostedVideo, reason: string) => {
      outcome.failed.push({ hostRef: h.hostRef!, reason });
      await warn('recording audience not changed on the video host', { orgId: input.orgId, host: h.host, hostRef: h.hostRef, audience: input.audience, reason });
      await store.noteVisibility(input.orgId, h.host, h.hostRef!, { visibilityError: reason.slice(0, 500) }).catch(() => {});
    };
    await Promise.all(due.map(async (h) => {
      if (!host || host.id !== h.host) {
        return fail(h, `${h.label ?? 'The video host'} is not connected to this workspace any more, so who may watch could not be changed.`);
      }
      const r = await host.setAudience(h.hostRef!, input.audience).catch((err: unknown) => ({ ok: false as const, reason: err instanceof Error ? err.message : String(err), retryable: true }));
      if (!r.ok) {
        return fail(h, r.reason);
      }
      outcome.changed.push(h.hostRef!);
      await store.noteVisibility(input.orgId, h.host, h.hostRef!, { visibility: r.visibility });
    }));
  } catch (err) {
    await warn('recording audience not changed', { orgId: input.orgId, audience: input.audience, error: err instanceof Error ? err.message : String(err) });
  }
  return outcome;
}

/** The store over the app's database. */
async function defaultStore(): Promise<AudienceStore> {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { artifactSchema } = await import('@/models/Schema');
  return {
    async noteVisibility(orgId, hostId, hostRef, patch) {
      // A state, not an edit: no new version. A success clears the last error.
      await db.update(artifactSchema)
        .set({ spec: sql`jsonb_set(${artifactSchema.spec}, '{hostedVideo}', ((${artifactSchema.spec} -> 'hostedVideo') - 'visibilityError') || ${JSON.stringify(patch)}::jsonb)` })
        .where(and(
          eq(artifactSchema.orgId, orgId),
          sql`${artifactSchema.spec} -> 'hostedVideo' ->> 'host' = ${hostId}`,
          sql`${artifactSchema.spec} -> 'hostedVideo' ->> 'hostRef' = ${hostRef}`,
        ));
    },
  };
}
