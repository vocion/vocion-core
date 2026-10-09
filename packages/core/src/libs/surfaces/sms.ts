import type { ChatImage, ChatInbound, ChatMessage, ChatParse, ChatPostRef, ChatReplyTarget, ChatSurfaceAdapter, ChatVerification } from './types';
import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import process from 'node:process';
import { absoluteAppLinks, appBaseUrl } from '@/libs/links';
import { toE164 } from '@/libs/phone';

/**
 * TEXT MESSAGES AS A CHAT SURFACE (Chris, 2026-10-07: "Extendable to SMS"), through Twilio.
 *
 * A workspace answers texts to a number it bound (`chat_channel_binding`, surface `sms`, the
 * channel is the number in E.164), the way a Slack workspace answers a channel. A text has no
 * thread, so the thread is the person: `sms:<workspace number>:<their number>`, one conversation
 * per person per number. Replies go out from the same number. A text carries no pictures here;
 * a picture or a demo goes as a link into Vocion.
 *
 * Twilio signs each webhook: base64 HMAC-SHA1, keyed with the auth token, over the URL Twilio
 * called followed by every form field sorted by name, each name then its value
 * (`X-Twilio-Signature`).
 */

/** The longest text sent as one; Twilio joins segments up to 1600 characters. */
export const SMS_MAX = 1500;

/** The URL Twilio is told to call, which the signature covers. */
export function smsWebhookUrl(): string {
  return `${appBaseUrl()}/api/webhooks/twilio/sms`;
}

/**
 * Twilio's signature over a form webhook.
 * @param url - The URL Twilio called.
 * @param params - The form fields.
 * @param authToken - The account's auth token.
 */
export function twilioSignature(url: string, params: Record<string, string>, authToken: string): string {
  const data = url + Object.keys(params).sort().map(k => `${k}${params[k]}`).join('');
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
}

/**
 * Check a webhook came from Twilio.
 * @param rawBody - The form body as received.
 * @param headers - The request headers.
 * @param authToken - The account's auth token.
 * @param url - The URL Twilio called.
 */
export function verifyTwilio(rawBody: string, headers: Headers, authToken: string | undefined, url: string): ChatVerification {
  if (!authToken) {
    return { ok: false, reason: 'missing_secret' };
  }
  const given = headers.get('x-twilio-signature');
  if (!given) {
    return { ok: false, reason: 'missing_headers' };
  }
  const want = twilioSignature(url, Object.fromEntries(new URLSearchParams(rawBody)), authToken);
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'bad_signature' };
}

/**
 * A Twilio messaging webhook, as a message the chat handler answers.
 * @param payload - The form fields.
 */
export function parseSms(payload: unknown): ChatParse {
  const f = (payload ?? {}) as Record<string, string>;
  const from = toE164(f.From);
  const to = toE164(f.To);
  if (!from || !to || !f.MessageSid) {
    return { kind: 'ignore', reason: 'not a text message' };
  }
  const text = (f.Body ?? '').trim();
  if (!text) {
    return { kind: 'ignore', reason: 'empty text' };
  }
  const inbound: ChatInbound = { surface: 'sms', teamId: null, channelId: to, threadRef: from, messageRef: f.MessageSid, externalUserId: from, text, isDirect: true };
  return { kind: 'message', inbound };
}

/**
 * The words of a text: markdown taken out, links made whole, pictures as links, cut to one text.
 * @param message - What to say.
 */
export function smsText(message: string | ChatMessage): string {
  const m = typeof message === 'string' ? { text: message } : message;
  const images: ChatImage[] = m.images ?? [];
  const body = absoluteAppLinks(m.text)
    .replace(/\[([^\]]+)\]\((\S+?)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$)/g, '$1$2')
    .replace(/^#+\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ');
  const links = images.map(i => `${i.caption}: ${absoluteAppLinks(i.url.startsWith('/api/') ? '/dashboard' : i.url)}`);
  const all = [body, ...links].join('\n');
  return all.length > SMS_MAX ? `${all.slice(0, SMS_MAX - 1).trimEnd()}…` : all;
}

/**
 * Send a text from the workspace's number.
 * @param from - The workspace's number.
 * @param to - The person's number.
 * @param body - The words.
 * @param fetchImpl - Injectable for tests.
 * @param mediaUrl - A public URL Twilio fetches and attaches, making it an MMS (an MP3 brief).
 */
export async function sendSms(from: string, to: string, body: string, fetchImpl: typeof fetch = fetch, mediaUrl?: string): Promise<{ sid: string } | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!sid || !token) {
    throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are not set; cannot text');
  }
  const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { 'authorization': `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: from, To: to, Body: body, ...(mediaUrl ? { MediaUrl: mediaUrl } : {}) }).toString(),
  });
  const out = await res.json().catch(() => ({})) as { sid?: string; message?: string };
  if (!res.ok) {
    throw new Error(`Twilio did not take the text: ${out.message ?? res.status}`);
  }
  return out.sid ? { sid: out.sid } : null;
}

export const smsSurface: ChatSurfaceAdapter = {
  id: 'sms',
  verify: (rawBody, headers) => verifyTwilio(rawBody, headers, process.env.TWILIO_AUTH_TOKEN?.trim(), smsWebhookUrl()),
  parse: parseSms,
  answerStyle: 'This arrived as a text message. Answer as a text: a few short plain sentences, no markdown, no tables, links written out in full, and point to Vocion for anything long.',
  reply: async (target: ChatReplyTarget, message): Promise<ChatPostRef | null> => {
    const sent = await sendSms(target.channelId, target.threadRef ?? '', smsText(message));
    return sent ? { channelId: target.channelId, ts: sent.sid, ...(target.threadRef ? { threadRef: target.threadRef } : {}), media: 'none' } : null;
  },
};
