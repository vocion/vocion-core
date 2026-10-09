/**
 * GET|POST /api/personal/push/stop?t=<signed token>
 *
 * The one-tap "stop these" in every push (docs/guides/push-to-you.md): turns
 * that one channel off for that one person, without signing in, and says so.
 * POST is the one-click unsubscribe mail clients send (RFC 8058,
 * `List-Unsubscribe-Post`). The token is signed by this server and names the
 * person, their Org and the channel; anything else is refused.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { readStopToken } from '@/libs/personal/stopLink';
import { stopChannel } from '@/services/personal/push';

const NAMES = { slack: 'Slack messages', sms: 'texts', email: 'emails' } as const;

function page(title: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#15131a;background:#fcfaf6;margin:0;padding:48px 20px"><main style="max-width:420px;margin:0 auto"><h1 style="font-size:22px;margin:0 0 8px">${title}</h1><p style="color:#625d66;margin:0">${body}</p></main></body></html>`;
  return new NextResponse(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

async function stop(req: NextRequest): Promise<NextResponse> {
  const claim = readStopToken(req.nextUrl.searchParams.get('t'));
  if (!claim) {
    return page('That link is not valid', 'Nothing was changed. You can turn these off under Notification settings → Your day.', 400);
  }
  await stopChannel(claim.userId, claim.accountId, claim.channel);
  return page('Stopped', `You will not get your brief or urgent items as ${NAMES[claim.channel]} any more. They still arrive in the app, and you can turn them back on under Notification settings → Your day.`);
}

export const GET = stop;
export const POST = stop;
