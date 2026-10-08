import type { ChatInbound, ChatSurfaceAdapter } from '@/libs/surfaces/types';
import { NextResponse } from 'next/server';
import { logger } from '@/libs/Logger';
import { getSurface } from '@/libs/surfaces/registry';
import { handleInbound, resolveBinding } from '@/services/ChatSurfaceService';

/**
 * ONE WEBHOOK SHAPE FOR EVERY TEXT-MESSAGE SURFACE — a text (Twilio, Vonage) or a WhatsApp
 * message to a number a workspace bound. Each route is this handler with its surface id, its
 * body reader and the empty answer its vendor expects; nothing below the parse knows the vendor.
 *
 * Verified before parsing (the workspace's own secret when the surface has one, `verifyAsync`),
 * acked at once, answered as its own message. A message from a member's number is answered by
 * the number's agent through the same handler as a Slack message: a reply that decides a waiting
 * card first, else a turn. A number Vocion does not know hears how to become known, and no
 * agent runs.
 */

/** How one vendor's webhook is read and answered. */
export type TextWebhookShape = {
  /** The body as form fields (or JSON fields), for the adapter's `parse`. */
  read: (raw: string, request: Request) => Record<string, string>;
  /** The empty reply the vendor wants back, at once. */
  ack: () => Response;
};

/**
 * Answer a text a person sent, after the ack: binding, sender, then a turn.
 * @param adapter - The surface.
 * @param inbound - The parsed message.
 */
export async function answerText(adapter: ChatSurfaceAdapter, inbound: ChatInbound): Promise<void> {
  const bound = await resolveBinding(inbound.surface, null, inbound.channelId);
  if (!bound) {
    logger.warn(`${inbound.surface} to an unbound number`, { to: inbound.channelId });
    return;
  }
  const { channelBySurface } = await import('@/services/chat/channels');
  const channel = channelBySurface(inbound.surface);
  const who = channel ? await channel.memberOf(bound.orgId, inbound.externalUserId) : { userId: null };
  if (!who.userId) {
    // A stranger's message runs nothing: one line on how to become someone Vocion knows.
    await adapter.reply({ channelId: inbound.channelId, threadRef: inbound.threadRef }, `This number answers members of a Vocion workspace. To message it, add ${channel?.signInHint(null) ?? 'your number to your Vocion profile'}.`).catch(() => null);
    logger.info(`${inbound.surface} from an unknown number`, { orgId: bound.orgId });
    return;
  }
  const r = await handleInbound(adapter, inbound);
  if (r.outcome === 'replied') {
    logger.info(`${inbound.surface} answered`, { orgId: r.orgId, agentSlug: r.agentSlug, conversationId: r.conversationId });
  } else {
    logger.warn(`${inbound.surface} not answered`, { ...r });
  }
}

/**
 * The whole webhook: verify, parse, ack, answer.
 * @param surfaceId - The surface's id (`sms`, `whatsapp`, `vonage`).
 * @param request - The request as received.
 * @param shape - How this vendor's body is read and acked.
 */
export async function handleTextWebhook(surfaceId: string, request: Request, shape: TextWebhookShape): Promise<Response> {
  const adapter = getSurface(surfaceId);
  if (!adapter) {
    return NextResponse.json({ error: `${surfaceId} surface not registered` }, { status: 500 });
  }
  const raw = request.method === 'GET' ? new URL(request.url).search.replace(/^\?/, '') : await request.text();
  const verified = adapter.verifyAsync ? await adapter.verifyAsync(raw, request.headers) : adapter.verify(raw, request.headers);
  if (!verified.ok) {
    logger.warn(`${surfaceId} refused`, { reason: verified.reason });
    return NextResponse.json({ error: `signature check failed: ${verified.reason}` }, { status: verified.reason === 'missing_secret' ? 501 : 401 });
  }
  const parsed = adapter.parse(shape.read(raw, request));
  if (parsed.kind !== 'message') {
    logger.info(`${surfaceId} ignored`, { reason: parsed.kind === 'ignore' ? parsed.reason : parsed.kind });
    return shape.ack();
  }
  void answerText(adapter, parsed.inbound)
    .catch(error => logger.error(`${surfaceId} failed`, { error: error instanceof Error ? error.message : String(error) }));
  return shape.ack();
}

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/** Twilio's shape: a form body, answered with empty TwiML. */
export const TWILIO_WEBHOOK: TextWebhookShape = {
  read: raw => Object.fromEntries(new URLSearchParams(raw)),
  ack: () => new NextResponse(EMPTY_TWIML, { status: 200, headers: { 'content-type': 'text/xml' } }),
};
