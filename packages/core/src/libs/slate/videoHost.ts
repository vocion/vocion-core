/**
 * Slate as a video host (`services/videoHost/host.ts`): connected when the
 * workspace holds a Slate token — on the `slate` connector it connected on the
 * Connections page, or as its one `slate` platform credential under Settings →
 * Credentials. The connector row's config says who may watch (`visibility`,
 * `team` by default) and, for a non-production Slate, its two addresses.
 *
 * The recording's share id is kept on the artifact as `slateShareId`, the
 * field the file spec has carried since recordings were first kept.
 */

import type { SlateCredentials, SlateFetch } from './client';
import type { VideoHost, VideoHostProvider } from '@/services/videoHost/host';
import { setSlateVisibility, slateCredentialsFrom, slateVisibilityFrom, uploadSlateVideo } from './client';

export const SLATE_CONNECTOR_SLUG = 'slate';
const LABEL = 'Slate';

/**
 * A host over one resolved credential. Exported for tests.
 * @param c - The credential.
 * @param visibility - Who may watch what it uploads (the workspace's choice);
 *   a recording asked for with audience `public` is `public` instead.
 * @param doFetch - The network.
 */
export function slateHostFor(c: SlateCredentials, visibility: unknown, doFetch?: SlateFetch): VideoHost {
  const vis = slateVisibilityFrom(visibility);
  return {
    id: SLATE_CONNECTOR_SLUG,
    label: LABEL,
    async publish(input) {
      const visibility = input.audience === 'public' ? 'public' : vis;
      const r = await uploadSlateVideo(c, { data: input.data, contentType: input.contentType, title: input.title, summary: input.summary, visibility }, doFetch);
      if (!r.ok) {
        return { ok: false, reason: r.message, retryable: r.retryable };
      }
      return {
        ok: true,
        shareId: r.data.shareId,
        hostRef: r.data.videoId,
        watchUrl: r.data.watchUrl,
        embedUrl: r.data.embedUrl,
        visibility: r.data.visibility,
      };
    },
    async setAudience(hostRef, audience) {
      const r = await setSlateVisibility(c, hostRef, audience === 'public' ? 'public' : vis, doFetch);
      return r.ok ? { ok: true, visibility: r.data.visibility } : { ok: false, reason: r.message, retryable: r.retryable };
    },
    specFields: shareId => ({ slateShareId: shareId }),
  };
}

/**
 * The connector row's config, when the workspace connected one.
 * @param orgId - The workspace.
 */
async function slateConfig(orgId: string): Promise<Record<string, unknown> | null> {
  const { and, eq, or, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { knowledgeSourceSchema } = await import('@/models/Schema');
  const [row] = await db
    .select({ configJson: knowledgeSourceSchema.configJson })
    .from(knowledgeSourceSchema)
    .where(and(
      eq(knowledgeSourceSchema.orgId, orgId),
      or(eq(knowledgeSourceSchema.slug, SLATE_CONNECTOR_SLUG), eq(sql`${knowledgeSourceSchema.configJson} ->> '_connector'`, SLATE_CONNECTOR_SLUG)),
    ))
    .orderBy(knowledgeSourceSchema.id)
    .limit(1);
  return row?.configJson ?? null;
}

export const slateVideoHost: VideoHostProvider = {
  id: SLATE_CONNECTOR_SLUG,
  label: LABEL,
  async resolve(orgId) {
    let values: Record<string, unknown> | null = null;
    try {
      const { getCredentialsForSource } = await import('@/services/SourceCredentialService');
      values = (await getCredentialsForSource(orgId, SLATE_CONNECTOR_SLUG)) ?? null;
    } catch {
      // A connected source whose credential was revoked: fall through to the
      // platform credential, and to none.
    }
    if (!values) {
      const { resolvePlatformCredential } = await import('@/services/ApiTokenService');
      values = await resolvePlatformCredential(orgId, 'slate');
    }
    if (!values) {
      return null;
    }
    const config = await slateConfig(orgId).catch(() => null);
    const parsed = slateCredentialsFrom(values, config);
    return parsed.ok ? slateHostFor(parsed.credentials, config?.visibility) : null;
  },
};
