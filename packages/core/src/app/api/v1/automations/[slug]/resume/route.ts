import { NextResponse } from 'next/server';
import { resumeAutomation } from '@/services/AutomationService';
import { authApi, isErrorResponse, requireCapability } from '../../../_shared';
import { controlActor, controlErrorResponse, readControlNote } from '../../_control';

/**
 * POST /api/v1/automations/:slug/resume  { note? } — lift a pause.
 *
 * Clears the hold, unpauses the Temporal Schedule for a schedule-when, and
 * records who lifted it and whose pause it was — the same `control` row the
 * dashboard's Resume writes. The note is optional here: the reason for a
 * resume is usually the pause's note, answered.
 *
 * Needs an owner or PM. Resuming an automation that is not paused answers
 * 409.
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
  const note = await readControlNote(req, { requireNote: false });
  if (isErrorResponse(note)) {
    return note;
  }
  const { slug } = await context.params;
  try {
    const by = await controlActor(caller);
    await resumeAutomation(caller.orgId, slug, { by, note });
    return NextResponse.json({ slug, paused: null }, { status: 200 });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
