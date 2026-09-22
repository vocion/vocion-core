import { NextResponse } from 'next/server';
import { lastRunBySlug, listAutomations, pausesFor, recentSkipsBySlug } from '@/services/AutomationService';
import { authApi, isErrorResponse } from '../_shared';

/**
 * GET /api/v1/automations — every automation, with its state.
 *
 * What an operator needs before deciding which one to stop: each
 * automation's `status` (the authored one), `paused` (a person's hold — who,
 * when, the note — or null), `when` and `do`, its `lastFire` (the most recent
 * real fire: id, kind, status, when it started and finished — a pause or a
 * refused match is not a fire), and `skips` — what the guards refused in the
 * last ten minutes, so a rate-limited automation is visible from the list.
 * @param req
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const rows = await listAutomations(caller.orgId);
  const [pauses, lastRuns, skips] = await Promise.all([
    pausesFor(rows),
    lastRunBySlug(caller.orgId),
    recentSkipsBySlug(caller.orgId),
  ]);
  const automations = rows.map((a) => {
    const last = lastRuns.get(a.slug) ?? null;
    return {
      slug: a.slug,
      name: a.name,
      description: a.description,
      status: a.status,
      ownerAgentSlug: a.ownerAgentSlug,
      when: a.whenConfig,
      do: a.doConfig,
      paused: pauses.get(a.slug) ?? null,
      lastFire: last
        ? { id: last.id, kind: last.kind, status: last.status, invokedBy: last.invokedBy, startedAt: last.startedAt, finishedAt: last.finishedAt, targetRunId: last.targetRunId }
        : null,
      skips: skips.get(a.slug) ?? null,
    };
  });
  return NextResponse.json({ automations, total: automations.length });
}
