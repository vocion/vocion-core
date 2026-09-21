import { NextResponse } from 'next/server';
import { pauseAutomation } from '@/services/AutomationService';
import { authApi, isErrorResponse, requireCapability } from '../../../_shared';
import { controlActor, controlErrorResponse, readControlNote } from '../../_control';

/**
 * POST /api/v1/automations/:slug/pause  { note } — the emergency stop.
 *
 * Holds the automation: a schedule-when's Temporal Schedule is paused, an
 * event-when is skipped by the matcher, and any fire that reaches
 * `beginAutomationFire` anyway is refused and recorded. The same service path
 * as the dashboard's Pause button, so the record is the same: who (the
 * session's person, or the API token), when, and the `note` — which is
 * required here, because a stop with no reason is the row nobody can act on
 * a week later.
 *
 * Needs an owner or PM (a tenant token carries its role; a `['*']` grant
 * passes too). Pausing an automation that is already paused answers 409 with
 * the current state, so a second operator learns the first got there.
 * @param req
 * @param context
 * @param context.params
 */
export async function POST(req: Request, context: { params: Promise<{ slug: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const denied = requireCapability(caller, 'pause_automation');
  if (denied) {
    return denied;
  }
  const note = await readControlNote(req, { requireNote: true });
  if (isErrorResponse(note)) {
    return note;
  }
  const { slug } = await context.params;
  try {
    const by = await controlActor(caller);
    const pause = await pauseAutomation(caller.orgId, slug, { by, note });
    return NextResponse.json({ slug, paused: pause }, { status: 200 });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
