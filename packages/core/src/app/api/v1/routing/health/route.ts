import { NextResponse } from 'next/server';
import { jevHealth, jevOutcomes } from '@/services/routing/health';
import { jevKeyStatus } from '@/services/routing/jevKey';
import { authApi, isErrorResponse, jsonError } from '../../_shared';

/**
 * GET /api/v1/routing/health?days=
 * Is Jev live here (ADR 0006, health)? For each decision Jev makes —
 * `factory` (a task's engine, model and effort), `turn` (an agent turn's model
 * and effort), `agent` (who answers a first message), `duplicate` (is a new
 * record one on file) — the decisions logged, how many Jev answered, used or
 * was unsure of, and how many failed and why (`auth` is a rejected key),
 * answer latency, the newest answer and failure, and the question versions
 * asked. Beside it, the outcomes already on record: factory runs by whose
 * route ran, first messages another agent answered later, duplicate links
 * undone. The key is named by scope and its last four characters, never more.
 * Auth: tenant API token or dashboard session.
 *
 * Query parameters:
 * - `days` — the window, 1 to 90 (default 7).
 * @param req - Request.
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const days = Number.parseInt(new URL(req.url).searchParams.get('days') ?? '7', 10);
  if (!Number.isFinite(days) || days < 1 || days > 90) {
    return jsonError('VALIDATION_FAILED', 'days must be between 1 and 90', 400);
  }
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const scope = { orgId: caller.orgId };
  const [decisions, outcomes, keys] = await Promise.all([jevHealth({ scope, from, to }), jevOutcomes({ scope, from, to }), jevKeyStatus(caller.orgId).catch(() => null)]);
  const onFile = keys?.effective === 'workspace' ? keys.workspace : keys?.effective === 'instance' ? keys.instance : null;
  return NextResponse.json({
    since: from.toISOString(),
    until: to.toISOString(),
    key: { effective: keys?.effective ?? null, hint: onFile?.hint ?? null, provider: onFile?.provider ?? null },
    decisions,
    outcomes,
  });
}
