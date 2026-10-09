import type { ChatInbound, ChatParse, ChatPostRef, ChatReplyTarget, ChatSurfaceAdapter, ChatVerification } from './types';
import { appBaseUrl } from '@/libs/links';
import { envVonageCredentials, sendVonageSms, verifyVonage, vonageCredentialsForChannel, vonageNumberToE164 } from '@/libs/vonage/client';
import { SMS_MAX, smsText } from './sms';

/**
 * TEXT MESSAGES THROUGH VONAGE — the text-message surface (`./sms.ts`) on a second carrier. Same
 * binding model (surface `vonage`, the channel is the workspace's number in E.164), same thread
 * (the person: `vonage:<workspace number>:<their number>`), same words (`smsText`), same sender
 * rule. Vonage's inbound SMS webhook arrives as a query string, a form or JSON depending on the
 * account's setting, so all three are read; it is checked with the account's signature secret
 * (`libs/vonage/client.ts`), the bound workspace's when it stored one, else the server's.
 */

/** Where Vonage is told to deliver inbound texts (Numbers → the number → Inbound webhook URL). */
export function vonageWebhookUrl(): string {
  return `${appBaseUrl()}/api/webhooks/vonage/sms`;
}

/**
 * A Vonage webhook body, whichever way the account sends it, as flat string fields.
 * @param raw - A query string, a form body or a JSON body.
 */
export function vonageParams(raw: string): Record<string, string> {
  const text = raw.trim();
  if (text.startsWith('{')) {
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(json).filter(([, v]) => v !== null && typeof v !== 'object').map(([k, v]) => [k, String(v)]));
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

/**
 * A Vonage inbound SMS, as a message the chat handler answers.
 * @param payload - The flat fields.
 */
export function parseVonage(payload: unknown): ChatParse {
  const f = (payload ?? {}) as Record<string, string>;
  const from = vonageNumberToE164(f.msisdn);
  const to = vonageNumberToE164(f.to);
  if (!from || !to || !f.messageId) {
    return { kind: 'ignore', reason: 'not a text message' };
  }
  const text = (f.text ?? '').trim();
  if (!text) {
    return { kind: 'ignore', reason: 'empty text' };
  }
  const inbound: ChatInbound = { surface: 'vonage', teamId: null, channelId: to, threadRef: from, messageRef: f.messageId, externalUserId: from, text, isDirect: true };
  return { kind: 'message', inbound };
}

/**
 * Check against the server's secret, then the bound workspace's.
 * @param rawBody - The body or query string.
 */
async function verifyVonageForChannel(rawBody: string): Promise<ChatVerification> {
  const params = vonageParams(rawBody);
  const env = verifyVonage(params, envVonageCredentials());
  if (env.ok || env.reason === 'missing_headers' || env.reason === 'stale') {
    return env;
  }
  const to = vonageNumberToE164(params.to);
  const creds = to ? await vonageCredentialsForChannel(to) : null;
  return creds ? verifyVonage(params, creds) : env;
}

export const vonageSurface: ChatSurfaceAdapter = {
  id: 'vonage',
  verify: rawBody => verifyVonage(vonageParams(rawBody), envVonageCredentials()),
  verifyAsync: rawBody => verifyVonageForChannel(rawBody),
  parse: parseVonage,
  answerStyle: 'This arrived as a text message. Answer as a text: a few short plain sentences, no markdown, no tables, links written out in full, and point to Vocion for anything long.',
  reply: async (target: ChatReplyTarget, message): Promise<ChatPostRef | null> => {
    const creds = await vonageCredentialsForChannel(target.channelId);
    if (!creds) {
      throw new Error('No Vonage account: connect Vonage for this workspace, or set VONAGE_API_KEY and VONAGE_API_SECRET; cannot text');
    }
    const sent = await sendVonageSms(creds, { from: target.channelId, to: target.threadRef ?? '', text: smsText(message).slice(0, SMS_MAX) });
    return sent ? { channelId: target.channelId, ts: sent.id, ...(target.threadRef ? { threadRef: target.threadRef } : {}), media: 'none' } : null;
  },
};
