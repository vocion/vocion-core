import { NextResponse } from 'next/server';
import { apiAgentBudgetStatuses } from '@/services/writeApi';
import { authApi, isErrorResponse, jsonError, requireCapability, writeApiErrorResponse } from '../../_shared';

/**
 * GET /api/v1/budgets/agents?period=daily|monthly
 *
 * Every agent in the workspace with the budget it is actually held to this
 * period: the hard cap in force, whose setting that cap is (`own`,
 * `workspace_agent_default`, `built_in_agent_default`), spend, what is left,
 * whether its next turn would be refused and why, and when the period resets.
 *
 * Unlike `GET /api/v1/budgets`, which lists stored rows, this includes agents
 * with no row — every new agent — because since #272 those run on a default
 * cap rather than none, and a caller trying to explain a refusal needs to see
 * it. Same numbers the refusal is decided on (`BudgetService.agentBudgetStatuses`).
 *
 * Requires the `manage_sources` capability, like `GET /api/v1/budgets`.
 * Auth: tenant API token or dashboard session.
 * @param req - `period` may be `daily` (default) or `monthly`.
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const denied = requireCapability(caller, 'manage_sources');
  if (denied) {
    return denied;
  }
  const requested = new URL(req.url).searchParams.get('period') ?? 'daily';
  if (requested !== 'daily' && requested !== 'monthly') {
    return jsonError('BAD_REQUEST', 'period must be "daily" or "monthly"', 400);
  }
  try {
    return NextResponse.json(await apiAgentBudgetStatuses(caller, requested));
  } catch (e) {
    return writeApiErrorResponse(e);
  }
}
