import { NextResponse } from 'next/server';
import { clerkAuth } from '@/libs/Auth';
import { startBulkBriefRegenerate } from '@/services/personalization/bulkRegenerate';
import { jsonError } from '../../_shared';

/**
 * Start a bulk action on the personalization queue (Metacto ticket 071).
 * Body: `{ kind: 'regenerate_brief', leadIds: number[], note: string }`.
 * Answers with the job id; the job page polls `GET /bulk/{id}`.
 */
export async function POST(req: Request) {
  const { userId, orgId } = await clerkAuth();
  if (!userId || !orgId) {
    return jsonError('UNAUTHORIZED', 'Missing or invalid credentials', 401);
  }
  const body = await req.json().catch(() => null) as { kind?: unknown; leadIds?: unknown; note?: unknown } | null;
  if (body?.kind !== 'regenerate_brief') {
    return jsonError('BAD_REQUEST', 'kind must be regenerate_brief', 400);
  }
  const leadIds = Array.isArray(body.leadIds) ? body.leadIds.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : '';
  if (!note) {
    return jsonError('BAD_REQUEST', 'An instruction is required: a brief rewrite without a reason teaches the next pass nothing', 400);
  }
  const result = await startBulkBriefRegenerate(orgId, { leadIds, note, by: userId });
  if (!result.ok) {
    const status = result.reason === 'queue_unreachable' ? 503 : 400;
    return jsonError(result.reason.toUpperCase(), result.message, status, result.refused ? { refused: result.refused } : undefined);
  }
  return NextResponse.json({ jobId: result.jobId, total: result.total });
}
