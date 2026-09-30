import { NextResponse } from 'next/server';
import { loadRecordStatus } from '@/services/objects/recordStatus';
import { authApi, isErrorResponse, jsonError, readIdParam } from '../../../_shared';

/**
 * GET /api/v1/objects/[id]/status
 *
 * Where one record is, in three lines: whether it needs you (and the one
 * move), what is running for it right now (the run, its page, since when),
 * and what happens next. For any record whose type has a report page in this
 * workspace; the same read the record's page, the preview pane and the chat
 * draw (`libs/factory/liveStatus.ts`). `live` is null when nothing is
 * running, so a poller stops then.
 * @param req - The request.
 * @param ctx - Route params.
 * @param ctx.params - `{ id }`.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const id = readIdParam((await ctx.params).id, 'object id');
  if (isErrorResponse(id)) {
    return id;
  }
  const read = await loadRecordStatus(caller.orgId, id);
  if (!read.ok) {
    return read.reason === 'not_found'
      ? jsonError('NOT_FOUND', 'object not found', 404)
      : jsonError('NO_REPORT_PAGE', 'this record\'s type has no report page in this workspace, so it has no status to read', 404);
  }
  return NextResponse.json(read.status);
}
