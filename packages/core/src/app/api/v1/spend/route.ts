import type { SpendGroup } from '@/services/spend/spend';
import { NextResponse } from 'next/server';
import { periodRange, SPEND_GROUPS, spendBy } from '@/services/spend/spend';
import { authApi, isErrorResponse, requireCapability, writeApiErrorResponse } from '../_shared';

/**
 * GET /api/v1/spend?group_by=agent&from=2026-10-01&to=2026-10-24
 *
 * What this workspace's model calls cost, from the spend ledger (`model_call`),
 * grouped one way: `workspace`, `agent`, `user`, `feature`, `model`, `run`,
 * `conversation` or `day`. `from` is inclusive and `to` exclusive (ISO dates or
 * times); without them, `period` (`today`, `7d`, `30d`, `90d`; default `30d`).
 * Filters: `agent`, `user`, `feature`, `model`, `run_kind`, `run_id`, `conversation`.
 *
 * Money is in micro-cents (millionths of a cent), as the ledger keeps it.
 * A token is scoped to its workspace, so this never reads another one.
 *
 * Requires the `manage_sources` capability, like the budget rows.
 * Auth: tenant API token or dashboard session.
 * @param req - The request.
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
  const q = new URL(req.url).searchParams;
  const groupBy = (q.get('group_by') ?? 'agent') as SpendGroup;
  if (!SPEND_GROUPS.includes(groupBy)) {
    return NextResponse.json({ error: `group_by must be one of ${SPEND_GROUPS.join(', ')}` }, { status: 400 });
  }
  const range = periodRange(q.get('period') ?? '30d');
  const from = q.get('from') ? new Date(q.get('from')!) : range.from;
  const to = q.get('to') ? new Date(q.get('to')!) : range.to;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    return NextResponse.json({ error: 'from and to must be dates, with from before to' }, { status: 400 });
  }
  const conversation = q.get('conversation');
  try {
    const result = await spendBy({
      scope: { orgId: caller.orgId },
      groupBy,
      from,
      to,
      filters: {
        ...(q.get('agent') ? { agentSlug: q.get('agent')! } : {}),
        ...(q.get('user') ? { userId: q.get('user')! } : {}),
        ...(q.get('feature') ? { feature: q.get('feature')! } : {}),
        ...(q.get('model') ? { model: q.get('model')! } : {}),
        ...(q.get('run_kind') ? { runKind: q.get('run_kind')! } : {}),
        ...(q.get('run_id') ? { runId: q.get('run_id')! } : {}),
        ...(conversation && /^\d+$/.test(conversation) ? { conversationId: Number(conversation) } : {}),
      },
    });
    return NextResponse.json({
      group_by: groupBy,
      from: from.toISOString(),
      to: to.toISOString(),
      rows: result.rows.map(r => ({ key: r.key, label: r.label, calls: r.calls, tokens: r.tokens, micro_cents: r.microCents })),
      total: { calls: result.total.calls, tokens: result.total.tokens, micro_cents: result.total.microCents },
    });
  } catch (e) {
    return writeApiErrorResponse(e);
  }
}
