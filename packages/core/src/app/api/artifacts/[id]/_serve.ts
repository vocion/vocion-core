import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { authApi } from '@/app/api/v1/_shared';
import { db } from '@/libs/DB';
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
      const [row] = await db.select().from(artifactSchema).where(eq(artifactSchema.id, rowId));
      return row ? { orgId: row.orgId, kind: row.kind, url: row.url, spec: row.spec, title: row.title, payload: toPayload(row) } : null;
    },
  });
  if (result.status !== 200) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Artifact not found' } }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
  }
  if ('json' in result) {
    // Card artifacts have no file: the spec IS the content.
    return NextResponse.json({ artifact: result.json }, { status: 200, headers: { 'Cache-Control': 'private, max-age=0, must-revalidate' } });
  }
  return new Response(new Uint8Array(result.body), { status: 200, headers: result.headers });
}
