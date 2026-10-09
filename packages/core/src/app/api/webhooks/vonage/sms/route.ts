import { NextResponse } from 'next/server';
import { vonageParams } from '@/libs/surfaces/vonage';
import { handleTextWebhook } from '@/services/chat/textWebhook';

/**
 * GET or POST /api/webhooks/vonage/sms — a text to a Vonage number a workspace bound (Numbers →
 * the number → Inbound webhook URL; any HTTP method the account is set to). Signed with the
 * account's signature secret (`libs/surfaces/vonage.ts`); answered by the number's agent through
 * the same handler as a Twilio text (`services/chat/textWebhook.ts`). Vonage wants a 200 at once.
 */
const VONAGE_WEBHOOK = {
  read: (raw: string) => vonageParams(raw),
  ack: () => new NextResponse(null, { status: 204 }),
};

export async function GET(request: Request) {
  return handleTextWebhook('vonage', request, VONAGE_WEBHOOK);
}

export async function POST(request: Request) {
  return handleTextWebhook('vonage', request, VONAGE_WEBHOOK);
}
