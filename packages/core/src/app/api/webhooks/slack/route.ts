import { NextResponse } from 'next/server';
import { logger } from '@/libs/Logger';
import { getSurface } from '@/libs/surfaces/registry';
import { handleInbound, handleJoined, slackEventsEnabled } from '@/services/ChatSurfaceService';

/**
 * POST /api/webhooks/slack — Slack Events API endpoint (approval item 025, phase 1).
 *
 * Order matters: the raw body is read once and verified BEFORE it is parsed;
 * an unverified request is a 401, never a 200 — unlike the Drive webhook, a
 * forged event here would reach the agent runtime. Slack retries a delivery it
 * did not get a 2xx for within 3 seconds, so the agent run is fired and
 * forgotten and the ack goes straight back; a retry (`x-slack-retry-num`) is
 * acknowledged and dropped so a slow first run does not answer twice.
 * @param request - Raw request.
 */
export async function POST(request: Request) {
  if (!slackEventsEnabled()) {
    return NextResponse.json({ error: 'Slack events are not enabled on this deployment (set VOCION_SLACK_EVENTS=1)' }, { status: 501 });
  }
  const adapter = getSurface('slack');
  if (!adapter) {
    return NextResponse.json({ error: 'slack surface not registered' }, { status: 500 });
  }
  const raw = await request.text();
  const verified = adapter.verify(raw, request.headers);
  if (!verified.ok) {
    logger.warn('slack event refused', { reason: verified.reason });
    const status = verified.reason === 'missing_secret' ? 501 : 401;
    return NextResponse.json({ error: `signature check failed: ${verified.reason}` }, { status });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'body is not JSON' }, { status: 400 });
  }
  const parsed = adapter.parse(payload);
  if (parsed.kind === 'challenge') {
    return NextResponse.json({ challenge: parsed.challenge });
  }
  if (parsed.kind === 'ignore') {
    // Nothing is dropped in silence (Chris, 2026-10-05: a bare "@Vocion" vanished with no line).
    logger.info('slack event ignored', { reason: parsed.reason });
    return NextResponse.json({ ok: true, ignored: parsed.reason });
  }
  if (request.headers.get('x-slack-retry-num')) {
    return NextResponse.json({ ok: true, ignored: 'retry' });
  }
  if (parsed.kind === 'joined') {
    // The bot was invited somewhere. One introduction, posted the same
    // fire-and-forget way as a reply; no agent runs.
    void handleJoined(adapter, parsed.join)
      .then(r => r.outcome === 'introduced' ? undefined : logger.warn('slack join not introduced', { ...r }))
      .catch(error => logger.error('slack join failed', { error: error instanceof Error ? error.message : String(error) }));
    return NextResponse.json({ ok: true });
  }
  // Ack now; reply from the agent lands in the thread when it is ready.
  void handleInbound(adapter, parsed.inbound)
    .then(r => r.outcome === 'replied'
      ? logger.info('slack mention answered', { orgId: r.orgId, agentSlug: r.agentSlug, conversationId: r.conversationId })
      : r.outcome === 'not_ours'
        ? logger.info('slack event ignored', { reason: 'thread reply in a thread Vocion is not in' })
        : logger.warn('slack mention not answered', { ...r }))
    .catch(error => logger.error('slack mention failed', { channelId: parsed.inbound.channelId, error: error instanceof Error ? error.message : String(error) }));
  return NextResponse.json({ ok: true });
}
