import type { NextRequest } from 'next/server';
import type { ArtifactRow } from '@/services/ArtifactService';
import { Buffer } from 'node:buffer';
import { NextResponse } from 'next/server';
import { locateMedia } from '@/libs/tools/artifacts/media';
import { mediaResponse } from '@/libs/tools/artifacts/mediaResponse';
import { resolveArtifactFile } from '@/libs/tools/artifacts/serve';
import { API_ARTIFACTS_BASE } from '@/libs/tools/artifacts/url';
import { serveVia } from '@/services/factory/featureShare';
import { sharedFeatureMedia } from '@/services/factory/featureShareData';

/** Nothing a public link serves is for a search engine. */
const PUBLIC = { 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' };

const notFound = () => NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404, headers: { 'Cache-Control': 'private, no-store', ...PUBLIC } });

/**
 * The bytes behind a picture held in the artifact store, served for a file
 * the public link already vouched for — the store's own resolver, with the
 * one row this link opens standing in as shared with anyone.
 * @param orgId - The link's workspace.
 * @param artifact - The vouched-for artifact.
 */
async function fromStore(orgId: string, artifact: ArtifactRow): Promise<Response | null> {
  const url = artifact.url ?? (typeof artifact.spec.url === 'string' ? artifact.spec.url : null);
  const segments = url?.startsWith(`${API_ARTIFACTS_BASE}/`) ? url.slice(API_ARTIFACTS_BASE.length + 1).split('?')[0]!.split('/') : [];
  const result = await resolveArtifactFile({
    callerOrgId: orgId,
    id: segments[0] ?? String(artifact.id),
    filename: segments[1],
    viewer: { userId: null, hasToken: true },
    lookupRow: async id => (id === artifact.id
      ? { orgId: artifact.orgId, kind: artifact.kind, url: artifact.url, spec: artifact.spec, title: artifact.title, shareAudience: 'anyone', shareOwnerId: null }
      : null),
    lookupShareByFile: async () => ({ audience: 'anyone', ownerId: null }),
  });
  if (result.status !== 200 || !('body' in result)) {
    return null;
  }
  return new Response(new Uint8Array(result.body), { status: 200, headers: { ...result.headers, ...PUBLIC } });
}

/**
 * `GET /api/share/feature/:token/media/:artifactId?k=<sig>` — one picture or
 * the recording on a feature's public page, to anyone holding the link.
 *
 * Never `/api/media` or `/api/artifacts`: those answer to a session. This
 * route answers to the link alone, and only for a file the page signed for
 * that link (`k`) that still belongs to the feature (`sharedFeatureMedia`).
 * A revoked link, another feature's file, a tampered signature and a file
 * narrowed to "Only me" are all the same 404.
 * @param req - The request.
 * @param ctx - The route.
 * @param ctx.params - The token and the artifact.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string; artifactId: string }> }) {
  const { token, artifactId } = await ctx.params;
  const id = Number(artifactId);
  const sig = req.nextUrl.searchParams.get('k') ?? '';
  if (!Number.isSafeInteger(id) || id <= 0 || !sig) {
    return notFound();
  }
  const found = await sharedFeatureMedia(decodeURIComponent(token), id, sig);
  if (!found) {
    return notFound();
  }
  const { orgId, artifact } = found;
  const via = serveVia({ kind: artifact.kind, url: artifact.url ?? null, spec: (artifact.spec ?? {}) as Record<string, unknown> });
  if (via === 'media') {
    const [recordId, filename] = (artifact.url ?? String(artifact.spec.url)).replace(/^\/api\/media\//, '').split('?')[0]!.split('/');
    const located = recordId && filename ? await locateMedia(orgId, recordId, filename) : null;
    return located ? mediaResponse(req, located, filename!, PUBLIC) : notFound();
  }
  if (via === 'stored' || via === 'file') {
    return (await fromStore(orgId, artifact)) ?? notFound();
  }
  if (via === 'data') {
    const url = artifact.url ?? String(artifact.spec.url);
    const m = /^data:(image\/(?:png|jpe?g|gif|webp));base64,(.+)$/i.exec(url);
    if (!m) {
      return notFound();
    }
    const body = Buffer.from(m[2]!, 'base64');
    return new Response(new Uint8Array(body), { status: 200, headers: { 'Content-Type': m[1]!.toLowerCase(), 'Content-Length': String(body.byteLength), 'Cache-Control': 'private, max-age=0, must-revalidate', 'X-Content-Type-Options': 'nosniff', ...PUBLIC } });
  }
  return notFound();
}
