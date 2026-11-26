import { NextResponse } from 'next/server';
import { loadEngineScoreboard } from '@/services/factory/engineRun';
import { authApi, isErrorResponse, jsonError } from '../../_shared';

/**
 * GET /api/v1/engine-runs/scoreboard?days=&source=
 * The engine scoreboard for the caller's org: one line per engine (and
 * source), with its runs, pull request rate, QA pass rate, acceptance rate,
 * median time, spend, cost per landed change, guard violations and retries
 * (ADR 0005). Brought up to date from the runs before it is read. Auth: tenant
 * API token or dashboard session.
 *
 * Query parameters:
 * - `days` — the window, 1 to 365 (default 30).
 * - `source` — `factory` or `eval`; both when omitted.
 * @param req - Request.
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const url = new URL(req.url);
  const days = Number.parseInt(url.searchParams.get('days') ?? '30', 10);
  if (!Number.isFinite(days) || days < 1 || days > 365) {
    return jsonError('VALIDATION_FAILED', 'days must be between 1 and 365', 400);
  }
  const source = url.searchParams.get('source') ?? undefined;
  if (source && source !== 'factory' && source !== 'eval') {
    return jsonError('VALIDATION_FAILED', 'source must be "factory" or "eval"', 400);
  }
  return NextResponse.json(await loadEngineScoreboard(caller.orgId, { days, source }));
}
