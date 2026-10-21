import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { BrowserRunBusyError, createBrowserRun } from '@/services/browser/BrowserRunService';
import { PRACTICE_EXAMPLE } from '@/services/browser/practiceSite';
import { authApi } from '../v1/_shared';

const noStore = { 'Cache-Control': 'private, no-store' };

/**
 * `POST /api/browser-runs` `{ example: "practice" }` — start the practice task
 * in the signed-in person's browser, as theirs. A run of anything else is
 * asked for in chat, where an agent briefs it (`browser_task`).
 * @param req - The request.
 */
export async function POST(req: NextRequest) {
  const caller = await authApi(req);
  if (caller instanceof NextResponse) {
    return caller;
  }
  if (caller.source !== 'session') {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'A browser run belongs to a person, signed in.' } }, { status: 403, headers: noStore });
  }
  const body = await req.json().catch(() => null) as { example?: string } | null;
  if (body?.example !== 'practice') {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Ask for a browser run in chat; this starts the practice task ({ "example": "practice" }).' } }, { status: 400, headers: noStore });
  }
  try {
    const run = await createBrowserRun({
      orgId: caller.orgId,
      userId: caller.actorId,
      task: PRACTICE_EXAMPLE.task,
      startUrl: PRACTICE_EXAMPLE.startUrl,
      inputs: { ...PRACTICE_EXAMPLE.inputs },
      secretNames: [...PRACTICE_EXAMPLE.secretInputs],
      outputs: PRACTICE_EXAMPLE.outputs.map(o => ({ ...o })),
      proposedBy: 'person',
      start: true,
    });
    return NextResponse.json({ run }, { headers: noStore });
  } catch (e) {
    if (e instanceof BrowserRunBusyError) {
      return NextResponse.json({ error: { code: 'CONFLICT', message: `Not started: ${e.message}` } }, { status: 409, headers: noStore });
    }
    throw e;
  }
}
