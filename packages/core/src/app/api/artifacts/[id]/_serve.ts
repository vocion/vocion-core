import type { NextRequest } from 'next/server';
import { and, eq, like } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { authApi } from '@/app/api/v1/_shared';
import { db } from '@/libs/DB';
import { verifyArtifactShare } from '@/libs/share/artifactShareToken';
import { resolveArtifactFile } from '@/libs/tools/artifacts/serve';
import { artifactSchema } from '@/models/Schema';
import { toPayload } from '@/services/ArtifactService';

/**
 * Shared handler for `/api/artifacts/[id]` and `/api/artifacts/[id]/[filename]`.
 * Auth is the same as the write API: a dashboard session or a `vcn_live_`
 * token, resolved by `authApi`. The caller's org must own the artifact; a
 * mismatch is a 404, not a 403. File artifacts stream their bytes; card
 * artifacts (table, markdown, chart, record, link) return their spec as
 * JSON (`{ artifact: ArtifactPayload }`) — there is no file behind them.
 * @param req
 * @param id
 * @param filename
 */
const notFound = () => NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Artifact not found' } }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });

/**
 * Who may read: a signed-in caller of the artifact's org, or — with
 * `?share=<token>` — anyone, while the artifact is STILL shared with anyone
 * (`libs/share/artifactShareToken.ts`). Narrowing the audience kills the
 * token on the next request; nothing is cached across that line.
 * @param req
 * @param id
 */
type Caller = { orgId: string; userId: string | null; hasToken: boolean };

async function callerOrgFor(req: NextRequest, id: string): Promise<Caller | NextResponse> {
  const token = req.nextUrl.searchParams.get('share');
  if (token) {
    const claim = verifyArtifactShare(token);
    if (!claim || String(claim.artifactId) !== id) {
      return notFound();
    }
    const [row] = await db.select({ orgId: artifactSchema.orgId, shareAudience: artifactSchema.shareAudience }).from(artifactSchema).where(eq(artifactSchema.id, claim.artifactId));
    if (!row || row.orgId !== claim.orgId || row.shareAudience !== 'anyone') {
      return notFound();
    }
    return { orgId: row.orgId, userId: null, hasToken: true };
  }
  const caller = await authApi(req);
  if (caller instanceof NextResponse) {
    return caller;
  }
  // `actorId` is the bare user id for a session and `token:<id>` for a bearer
  // token. Only a person can satisfy the `me` audience, so a token resolves to
  // no user rather than to a string that could never match an owner anyway.
  return {
    orgId: caller.orgId,
    userId: caller.source === 'session' ? caller.actorId : null,
    hasToken: false,
  };
}

export async function serveArtifact(req: NextRequest, id: string, filename?: string): Promise<Response> {
  const caller = await callerOrgFor(req, id);
  if (caller instanceof NextResponse) {
    return caller;
  }
  const result = await resolveArtifactFile({
    callerOrgId: caller.orgId,
    id,
    filename,
    viewer: { userId: caller.userId, hasToken: caller.hasToken },
    lookupRow: async (rowId) => {
      const [row] = await db.select().from(artifactSchema).where(eq(artifactSchema.id, rowId));
      return row ? { orgId: row.orgId, kind: row.kind, url: row.url, spec: row.spec, title: row.title, payload: toPayload(row), shareAudience: row.shareAudience, shareOwnerId: row.shareOwnerId } : null;
    },
    // For the content-addressed id, which names a stored file rather than a
    // row. A file artifact's row URL ends in that filename, so the row that
    // claims it is the row whose audience applies. Scoped to the caller's org,
    // so a filename collision across tenants cannot widen anything.
    lookupShareByFile: async (filename) => {
      const [row] = await db
        .select({ shareAudience: artifactSchema.shareAudience, shareOwnerId: artifactSchema.shareOwnerId })
        .from(artifactSchema)
        .where(and(eq(artifactSchema.orgId, caller.orgId), like(artifactSchema.url, `%${filename}`)))
        .limit(1);
      return row ? { audience: row.shareAudience, ownerId: row.shareOwnerId } : null;
    },
  });
  if (result.status !== 200) {
    return notFound();
  }
  if ('json' in result) {
    // Card artifacts have no file: the spec IS the content.
    return NextResponse.json({ artifact: result.json }, { status: 200, headers: { 'Cache-Control': 'private, max-age=0, must-revalidate' } });
  }
  return new Response(new Uint8Array(result.body), { status: 200, headers: result.headers });
}
