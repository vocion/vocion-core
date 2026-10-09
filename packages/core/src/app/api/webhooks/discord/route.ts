import { NextResponse } from 'next/server';
import { logger } from '@/libs/Logger';
import { getSurface } from '@/libs/surfaces/registry';
import { handleInbound, resolveBinding } from '@/services/ChatSurfaceService';

/**
 * POST /api/webhooks/discord — the Discord application's Interactions Endpoint URL
 * (`libs/surfaces/discord.ts`). Verified with Ed25519 against the server's or the bound
 * workspace's public key before anything is read; an unverified request is a 401, which is also
 * how Discord checks the endpoint when it is saved. A PING is answered with a PONG. An `/ask` is
 * acknowledged at once with the question quoted back — Discord wants an answer within three
 * seconds — and the agent answers in the channel when it is ready, through the same handler as
 * a Slack mention.
 * @param request - The interaction.
 */
export async function POST(request: Request) {
  const adapter = getSurface('discord');
  if (!adapter) {
    return NextResponse.json({ error: 'discord surface not registered' }, { status: 500 });
  }
  const raw = await request.text();
  const verified = adapter.verifyAsync ? await adapter.verifyAsync(raw, request.headers) : adapter.verify(raw, request.headers);
  if (!verified.ok) {
    logger.warn('discord interaction refused', { reason: verified.reason });
    return NextResponse.json({ error: `signature check failed: ${verified.reason}` }, { status: verified.reason === 'missing_secret' ? 501 : 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'body is not JSON' }, { status: 400 });
  }
  const parsed = adapter.parse(payload);
  if (parsed.kind === 'challenge') {
    return NextResponse.json({ type: 1 });
  }
  if (parsed.kind !== 'message') {
    logger.info('discord interaction ignored', { reason: parsed.kind === 'ignore' ? parsed.reason : parsed.kind });
    // An ephemeral line, so the person who typed it is never left with "the application did not respond".
    return NextResponse.json({ type: 4, data: { content: 'Vocion only answers /ask here.', flags: 64 } });
  }
  const { inbound } = parsed;
  if (!(await resolveBinding('discord', inbound.teamId, inbound.channelId))) {
    // Nothing answers here: say so to the asker alone, rather than quote a question nobody will answer.
    return NextResponse.json({ type: 4, data: { content: 'No Vocion agent answers in this channel yet. A workspace admin binds it in Vocion (surface discord, this channel id, or * for the whole server).', flags: 64 } });
  }
  void handleInbound(adapter, inbound)
    .then(r => r.outcome === 'replied'
      ? logger.info('discord ask answered', { orgId: r.orgId, agentSlug: r.agentSlug, conversationId: r.conversationId })
      : logger.warn('discord ask not answered', { ...r }))
    .catch(error => logger.error('discord ask failed', { channelId: inbound.channelId, error: error instanceof Error ? error.message : String(error) }));
  const quoted = inbound.text.length > 1900 ? `${inbound.text.slice(0, 1899)}…` : inbound.text;
  return NextResponse.json({ type: 4, data: { content: `> ${quoted.replace(/\n/g, '\n> ')}`, allowed_mentions: { parse: [] } } });
}
