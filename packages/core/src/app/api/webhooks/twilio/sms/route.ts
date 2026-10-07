import { NextResponse } from 'next/server';
import { logger } from '@/libs/Logger';
import { getSurface } from '@/libs/surfaces/registry';
import { handleInbound, resolveBinding } from '@/services/ChatSurfaceService';

/**
 * POST /api/webhooks/twilio/sms — a text to a number a workspace bound (Twilio's messaging
 * webhook; point the number's "A message comes in" here). Signed by Twilio
 * (`libs/surfaces/sms.ts`). A text from a member's number (`me.set_phone`) is answered by the
 * number's agent, through the same handler as a Slack message: a reply that decides a waiting
 * card first, else a turn. A number Vocion does not know hears how to become known, and no
 * agent runs. Twilio is answered at once with an empty reply; the answer goes out as its own text.
 */
const EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const twiml = (status = 200) => new NextResponse(EMPTY, { status, headers: { 'content-type': 'text/xml' } });

export async function POST(request: Request) {
  const adapter = getSurface('sms');
  if (!adapter) {
    return NextResponse.json({ error: 'sms surface not registered' }, { status: 500 });
  }
  const raw = await request.text();
  const verified = adapter.verify(raw, request.headers);
  if (!verified.ok) {
    logger.warn('sms refused', { reason: verified.reason });
    return NextResponse.json({ error: `signature check failed: ${verified.reason}` }, { status: verified.reason === 'missing_secret' ? 501 : 401 });
  }
  const parsed = adapter.parse(Object.fromEntries(new URLSearchParams(raw)));
  if (parsed.kind !== 'message') {
    logger.info('sms ignored', { reason: parsed.kind === 'ignore' ? parsed.reason : parsed.kind });
    return twiml();
  }
  const { inbound } = parsed;
  void (async () => {
    const bound = await resolveBinding('sms', null, inbound.channelId);
    if (!bound) {
      logger.warn('sms to an unbound number', { to: inbound.channelId });
      return;
    }
    const { channelBySurface } = await import('@/services/chat/channels');
    const channel = channelBySurface('sms')!;
    const who = await channel.memberOf(bound.orgId, inbound.externalUserId);
    if (!who.userId) {
      // A stranger's text runs nothing: one line on how to become someone Vocion knows.
      await adapter.reply({ channelId: inbound.channelId, threadRef: inbound.threadRef }, `This number answers members of a Vocion workspace. To text it, add ${channel.signInHint(null)}.`).catch(() => null);
      logger.info('sms from an unknown number', { orgId: bound.orgId });
      return;
    }
    const r = await handleInbound(adapter, inbound);
    if (r.outcome === 'replied') {
      logger.info('sms answered', { orgId: r.orgId, agentSlug: r.agentSlug, conversationId: r.conversationId });
    } else {
      logger.warn('sms not answered', { ...r });
    }
  })().catch(error => logger.error('sms failed', { error: error instanceof Error ? error.message : String(error) }));
  return twiml();
}
