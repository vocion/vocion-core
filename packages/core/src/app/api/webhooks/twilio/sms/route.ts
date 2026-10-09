import { handleTextWebhook, TWILIO_WEBHOOK } from '@/services/chat/textWebhook';

/**
 * POST /api/webhooks/twilio/sms — a text to a number a workspace bound (Twilio's messaging
 * webhook; point the number's "A message comes in" here). Signed by Twilio with the server's or
 * the bound workspace's auth token (`libs/surfaces/sms.ts`). A text from a member's number
 * (`me.set_phone`) is answered by the number's agent; one from a stranger hears how to become
 * known (`services/chat/textWebhook.ts`). Twilio is answered at once with an empty reply; the
 * answer goes out as its own text.
 *
 * A SHARED number (bound with `answers: "sender"`, the agent `*`) is the account's one number:
 * the member who texted is found on the binding's account, and their own assistant answers in
 * their personal workspace (`services/chat/ownAssistant.ts`).
 * @param request - The webhook.
 */
export async function POST(request: Request) {
  return handleTextWebhook('sms', request, TWILIO_WEBHOOK);
}
