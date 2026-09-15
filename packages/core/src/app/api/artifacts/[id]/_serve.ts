import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { authApi } from '@/app/api/v1/_shared';
import { db } from '@/libs/DB';
import { resolveArtifactFile } from '@/libs/tools/artifacts/serve';
import { artifactSchema } from '@/models/Schema';

/**
 * Shared handler for `/api/artifacts/[id]` and `/api/artifacts/[id]/[filename]`.
 * Auth is the same as the write API: a dashboard session or a `vcn_live_`
 * token, resolved by `authApi`. The caller's org must own the artifact; a
 * mismatch is a 404, not a 403.
 * @param req
 * @param id
 * @param filename
 */
export async function serveArtifact(req: NextRequest, id: string, filename?: string): Promise<Response> {
  const caller = await authApi(req);
  if (caller instanceof NextResponse) {
    return caller;
  }
  const result = await resolveArtifactFile({
    callerOrgId: caller.orgId,
    id,
    filename,
    lookupRow: async (rowId) => {
      const [row] = await db
        .select({ orgId: artifactSchema.orgId, url: artifactSchema.url, spec: artifactSchema.spec, title: artifactSchema.title })
        .from(artifactSchema)
        .where(eq(artifactSchema.id, rowId));
      return row ?? null;
    },
  });
  if (result.status !== 200) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Artifact not found' } }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
  }
  return new Response(new Uint8Array(result.body), { status: 200, headers: result.headers });
}
