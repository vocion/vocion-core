import type { ArtifactRow, Author } from '@/services/ArtifactService';
import { NextResponse } from 'next/server';
import { authApi } from '@/app/api/v1/_shared';
import { canOpenArtifact } from '@/libs/share/audience';
import { getArtifact } from '@/services/ArtifactService';

export const noStore = { 'Cache-Control': 'private, no-store' };

/**
 * A refusal the pane shows as it is: `{ ok: false, reason }`.
 * @param status - The HTTP status.
 * @param reason - One sentence for a person.
 * @param extra - More fields (`diff`, `currentVersion`).
 */
export function refuse(status: number, reason: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ ok: false, reason, ...extra }, { status, headers: noStore });
}

/**
 * The deck or document a deliverable route acts on, for the caller who may
 * open it. Auth is the artifact routes' own (`authApi`: a dashboard session or
 * a `vcn_live_` token), scoped to the caller's workspace; anything else — a
 * missing row, another workspace's, one shared away from this person, a kind
 * that is not a deliverable — is a 404 that says nothing more.
 * @param req - The request.
 * @param rawId - The `[artifactId]` segment.
 */
export async function deliverableFor(req: Request, rawId: string): Promise<{ orgId: string; author: Author; row: ArtifactRow & { kind: 'deck' | 'document' } } | NextResponse> {
  const notFound = () => refuse(404, 'No such deck or document.');
  if (!/^\d{1,12}$/.test(rawId)) {
    return notFound();
  }
  const caller = await authApi(req);
  if (caller instanceof NextResponse) {
    return caller;
  }
  const row = await getArtifact({ orgId: caller.orgId, id: Number(rawId) });
  if (!row || (row.kind !== 'deck' && row.kind !== 'document')) {
    return notFound();
  }
  const userId = caller.source === 'session' ? caller.actorId : null;
  if (!canOpenArtifact({ audience: row.shareAudience, ownerId: row.shareOwnerId ?? null }, { userId, hasToken: false, isMember: true })) {
    return notFound();
  }
  return { orgId: caller.orgId, author: { kind: 'human', id: caller.actorId }, row: row as ArtifactRow & { kind: 'deck' | 'document' } };
}

/**
 * `attachment` with an ASCII fallback and the UTF-8 name.
 * @param name - The filename.
 */
export function attachmentDisposition(name: string): string {
  return `attachment; filename="${name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '\'')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
