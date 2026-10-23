import { NextResponse } from 'next/server';
import { listEngineRuns } from '@/services/factory/engineRun';
import { authApi, isErrorResponse, readPagination } from '../_shared';

/**
 * GET /api/v1/engine-runs?engine=&source=&limit=&offset=
 * The engine scoreboard's rows for the caller's org, newest first: one per
 * engineering run, whichever engine did it (ADR 0005). Auth: tenant API token
 * or dashboard session.
 *
 * Query parameters:
 * - `engine` — one engine's runs (`claude-cli`, `openhands`).
 * - `source` — `factory` (real work) or `eval` (the runner's eval harness).
 * @param req - Request.
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const url = new URL(req.url);
  const { limit, offset } = readPagination(url);
  const runs = await listEngineRuns(caller.orgId, {
    engine: url.searchParams.get('engine') ?? undefined,
    source: url.searchParams.get('source') ?? undefined,
    limit,
    offset,
  });
  return NextResponse.json({ runs });
}
