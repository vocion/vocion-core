import type { ChatImage, ChatInbound, ChatMessage, ChatParse, ChatPostRef, ChatReplyTarget, ChatSurfaceAdapter } from './types';
import process from 'node:process';
import { absoluteAppLinks, appBaseUrl } from '@/libs/links';
import { toE164 } from '@/libs/phone';
import { sendTwilioMessage, twilioCredentialsForChannel } from '@/libs/twilio/client';
import { verifyTwilio, verifyTwilioForChannel } from './sms';

/**
 * WHATSAPP AS A CHAT SURFACE, through a Twilio WhatsApp sender — the text-message surface
 * (`./sms.ts`) on another medium. Same binding model: a workspace binds its WhatsApp number
 * (surface `whatsapp`, the channel is the number in E.164), the thread is the person
 * (`whatsapp:<workspace number>:<their number>`), a sender is the member whose profile holds the
 * number, and replies go out from the same sender. Same signature: Twilio signs the webhook with
 * the account's auth token. Twilio writes WhatsApp addresses `whatsapp:+1…`; inside Vocion they
 * are plain E.164, and the prefix is put back only on the way out.
 *
 * WhatsApp renders *bold* and _italic_, so markdown is turned into those rather than stripped.
 * A message the person did not start more than 24 hours ago needs an approved template on
 * WhatsApp's side; Vocion only ever answers, inside that window.
 */

/** WhatsApp takes 4096 characters; Twilio caps a message body at 1600. */
export const WHATSAPP_MAX = 1600;

/** The URL Twilio is told to call, which the signature covers. */
export function whatsappWebhookUrl(): string {
  return `${appBaseUrl()}/api/webhooks/twilio/whatsapp`;
}

/**
 * A Twilio WhatsApp address (`whatsapp:+14155550100`) as E.164, or null.
 * @param raw - The `From` or `To` field.
 */
export function fromWhatsAppAddress(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  return text.toLowerCase().startsWith('whatsapp:') ? toE164(text.slice('whatsapp:'.length)) : null;
}

/**
 * A Twilio WhatsApp webhook, as a message the chat handler answers.
 * @param payload - The form fields.
 */
export function parseWhatsApp(payload: unknown): ChatParse {
  const f = (payload ?? {}) as Record<string, string>;
  const from = fromWhatsAppAddress(f.From);
  const to = fromWhatsAppAddress(f.To);
  if (!from || !to || !f.MessageSid) {
    return { kind: 'ignore', reason: 'not a WhatsApp message' };
  }
  const text = (f.Body ?? '').trim();
  if (!text) {
    return { kind: 'ignore', reason: Number(f.NumMedia ?? 0) > 0 ? 'a picture with no words; pictures are not read on WhatsApp yet' : 'empty message' };
  }
  const inbound: ChatInbound = { surface: 'whatsapp', teamId: null, channelId: to, threadRef: from, messageRef: f.MessageSid, externalUserId: from, text, isDirect: true };
  return { kind: 'message', inbound };
}

/**
 * The words of a WhatsApp message: markdown as WhatsApp writes it, links made whole, pictures as
 * links, cut to one message.
 * @param message - What to say.
 */
export function whatsappText(message: string | ChatMessage): string {
  const m = typeof message === 'string' ? { text: message } : message;
  const images: ChatImage[] = m.images ?? [];
  const body = absoluteAppLinks(m.text)
    .replace(/\[([^\]]+)\]\((\S+?)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '*$1*')
    .replace(/^#+ (\S.*)$/gm, '*$1*')
    .replace(/^\s*[-*]\s+/gm, '• ');
  const links = images.map(i => `${i.caption}: ${absoluteAppLinks(i.url.startsWith('/api/') ? '/dashboard' : i.url)}`);
  const all = [body, ...links].join('\n');
  return all.length > WHATSAPP_MAX ? `${all.slice(0, WHATSAPP_MAX - 1).trimEnd()}…` : all;
}

/**
 * Send a WhatsApp message from the workspace's sender, on the Twilio account behind it.
 * @param from - The workspace's WhatsApp number, E.164.
 * @param to - The person's number, E.164.
 * @param body - The words.
 * @param fetchImpl - Injectable for tests.
 */
export async function sendWhatsApp(from: string, to: string, body: string, fetchImpl: typeof fetch = fetch): Promise<{ sid: string } | null> {
  const creds = await twilioCredentialsForChannel('whatsapp', from);
  if (!creds) {
    throw new Error('No Twilio account: connect Twilio for this workspace, or set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN; cannot send on WhatsApp');
  }
  return sendTwilioMessage(creds, { from: `whatsapp:${from}`, to: `whatsapp:${to}`, body }, fetchImpl);
}

export const whatsappSurface: ChatSurfaceAdapter = {
  id: 'whatsapp',
  verify: (rawBody, headers) => verifyTwilio(rawBody, headers, process.env.TWILIO_AUTH_TOKEN?.trim(), whatsappWebhookUrl()),
  verifyAsync: (rawBody, headers) => verifyTwilioForChannel('whatsapp', rawBody, headers, whatsappWebhookUrl(), form => fromWhatsAppAddress(form.To)),
  parse: parseWhatsApp,
  answerStyle: 'This arrived on WhatsApp. Answer as a chat message: a few short plain sentences, *bold* for the one thing that matters, no tables, links written out in full, and point to Vocion for anything long.',
  reply: async (target: ChatReplyTarget, message): Promise<ChatPostRef | null> => {
    const sent = await sendWhatsApp(target.channelId, target.threadRef ?? '', whatsappText(message));
    return sent ? { channelId: target.channelId, ts: sent.sid, ...(target.threadRef ? { threadRef: target.threadRef } : {}), media: 'none' } : null;
  },
};
