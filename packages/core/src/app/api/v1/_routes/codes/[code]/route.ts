import { NextResponse } from 'next/server';
import { hrefForCode } from '@/services/codeLinks';
import { resolveCode } from '@/services/codes';
import { authApi, isErrorResponse, jsonError } from '../../_shared';

/**
 * GET /api/v1/codes/[code]
 *
 * What a code names in this workspace — `FE-294`, `run-439`, or an old bare
 * `294` — and where it opens. Case-insensitive. Answers `{ code, kind, id,
 * title?, href }`: `kind` is `record` (with the record's title) or the core
 * noun (`run`, `action`, `ask`, `conversation`, `artifact`, `automation`).
 * A code whose prefix is not the record's type is a 404 that says what the
 * record's code is. What ⌘K reads when a person types a code.
 * @param req - The request.
 * @param ctx - Route params.
 * @param ctx.params - `{ code }`.
 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const raw = decodeURIComponent((await ctx.params).code);
  const resolved = await resolveCode(caller.orgId, raw);
  if (resolved.kind === 'none') {
    return jsonError('NOT_FOUND', resolved.reason, 404);
  }
  return NextResponse.json({
    code: resolved.code,
    kind: resolved.kind,
    id: resolved.id,
    ...(resolved.kind === 'record' ? { title: resolved.title } : {}),
    href: await hrefForCode(caller.orgId, resolved),
  });
}
