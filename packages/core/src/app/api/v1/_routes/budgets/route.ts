import { NextResponse } from 'next/server';
import { apiListAgentBudgets } from '@/services/writeApi';
import { authApi, isErrorResponse, requireCapability, writeApiErrorResponse } from '../_shared';

/**
 * GET /api/v1/budgets
 *
 * Every `agent_budget` row for this org, with the limit columns the dashboard
 * never shows: soft and hard token and cents caps, the current period's usage,
 * the period and when it started. That is what answers "would this agent's next
 * run be refused?" without a database connection per tenant.
 *
 * Read-only to the caller, though reading rolls a period boundary that has
 * passed (idempotently), so the counters are the active period's.
 *
 * Requires the `manage_sources` capability.
 * Auth: tenant API token or dashboard session.
 * @param req
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
  try {
    return NextResponse.json(await apiListAgentBudgets(caller));
  } catch (e) {
    return writeApiErrorResponse(e);
  }
}
