import process from 'node:process';
import { NextResponse } from 'next/server';
import { parseResendPayload, verifySvixSignature } from '@/libs/surfaces/email';
import { emailSurfaceEnabled, handleInboundEmail } from '@/services/EmailSurfaceService';

/**
 * POST /api/webhooks/resend — Resend's `email.received` webhook: a mail
 * arrived at one of this deployment's workspace mailboxes.
 *
 * Same discipline as the Slack webhook: the raw body is read once and
 * verified (Svix signature, `RESEND_WEBHOOK_SECRET`) BEFORE it is parsed; an
 * unverified request is a 401, never a 200. The webhook carries metadata
 * only, so the handler fetches the body from Resend's receiving API and then
 * runs the workspace lead — fired and forgotten, the ack goes straight back.
 * A redelivery of an email we already recorded is dropped inside the handler
 * (`email_thread.received_email_id`), so a slow first run never answers twice.
 * @param request - Raw request.
 */
export async function POST(request: Request) {
  if (!emailSurfaceEnabled()) {
    return NextResponse.json({ error: 'The email surface is not enabled on this deployment (set VOCION_EMAIL_SURFACE=1)' }, { status: 501 });
  }
  const raw = await request.text();
  const verified = verifySvixSignature(raw, request.headers, process.env.RESEND_WEBHOOK_SECRET);
  if (!verified.ok) {
    const status = verified.reason === 'missing_secret' ? 501 : 401;
    return NextResponse.json({ error: `signature check failed: ${verified.reason}` }, { status });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'body is not JSON' }, { status: 400 });
  }
  const parsed = parseResendPayload(payload);
  if (parsed.kind === 'ignore') {
    return NextResponse.json({ ok: true, ignored: parsed.reason });
  }
  void handleInboundEmail(parsed.inbound).catch(() => {});
  return NextResponse.json({ ok: true });
}
