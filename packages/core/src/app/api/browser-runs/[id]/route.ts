import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { answerBrowserRun, BrowserRunBusyError, BrowserRunError, getBrowserRun, startBrowserRun, stopBrowserRun } from '@/services/browser/BrowserRunService';
import { authApi } from '../../v1/_shared';

const noStore = { 'Cache-Control': 'private, no-store' };
const notFound = () => NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Browser run not found' } }, { status: 404, headers: noStore });

/**
 * `GET /api/browser-runs/:id` — a browser run as its pane draws it
 * (`libs/browser/run.ts` `BrowserRunView`), re-read about once a second
 * while it runs. Any member of the run's workspace may read it.
 * @param req - The request.
 * @param ctx - The route.
 * @param ctx.params - Its params.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^\d{1,12}$/.test(id)) {
    return notFound();
  }
  const caller = await authApi(req);
  if (caller instanceof NextResponse) {
    return caller;
  }
  const run = await getBrowserRun(caller.orgId, Number(id));
  return run ? NextResponse.json({ run }, { headers: noStore }) : notFound();
}

const Action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  z.object({ action: z.literal('stop') }),
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('deny'), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal('answer'), text: z.string().trim().min(1).max(500) }),
]);

/**
 * `POST /api/browser-runs/:id` `{ action }` — the person's hand on their run:
 * start a suggested one, stop it, approve or decline the step it holds, or
 * answer its question. Only the run's own person, signed in, may.
 * @param req - The request.
 * @param ctx - The route.
 * @param ctx.params - Its params.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^\d{1,12}$/.test(id)) {
    return notFound();
  }
  const caller = await authApi(req);
  if (caller instanceof NextResponse) {
    return caller;
  }
  if (caller.source !== 'session') {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Only the person whose browser it is can do this, signed in.' } }, { status: 403, headers: noStore });
  }
  const parsed = Action.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'action must be start, stop, approve, deny or answer' } }, { status: 400, headers: noStore });
  }
  const runId = Number(id);
  const a = parsed.data;
  try {
    if (a.action === 'start') {
      await startBrowserRun(caller.orgId, caller.actorId, runId);
    } else if (a.action === 'stop') {
      await stopBrowserRun(caller.orgId, caller.actorId, runId);
    } else if (a.action === 'approve') {
      await answerBrowserRun(caller.orgId, caller.actorId, runId, { kind: 'approve' });
    } else if (a.action === 'deny') {
      await answerBrowserRun(caller.orgId, caller.actorId, runId, { kind: 'deny', note: a.note });
    } else {
      await answerBrowserRun(caller.orgId, caller.actorId, runId, { kind: 'answer', text: a.text });
    }
  } catch (e) {
    if (e instanceof BrowserRunBusyError || e instanceof BrowserRunError) {
      return NextResponse.json({ error: { code: 'CONFLICT', message: e.message } }, { status: 409, headers: noStore });
    }
    throw e;
  }
  const run = await getBrowserRun(caller.orgId, runId);
  return NextResponse.json({ run }, { headers: noStore });
}
