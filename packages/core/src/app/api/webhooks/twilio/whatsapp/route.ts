import { handleTextWebhook, TWILIO_WEBHOOK } from '@/services/chat/textWebhook';

/**
 * POST /api/webhooks/twilio/whatsapp — a WhatsApp message to a WhatsApp sender a workspace bound
 * (Twilio's WhatsApp sender webhook; point the sender's "A message comes in" here). The same
 * handler as a text (`services/chat/textWebhook.ts`), on the `whatsapp` surface
 * (`libs/surfaces/whatsapp.ts`): signed by Twilio, answered by the number's agent.
 * @param request - The webhook.
 */
export async function POST(request: Request) {
  return handleTextWebhook('whatsapp', request, TWILIO_WEBHOOK);
}
