import type { ChannelOutcome, NotificationMessage } from './outcome';
import process from 'node:process';
import { SMS_MAX, smsText } from '@/libs/surfaces/sms';

/**
 * TEXT MESSAGE (Vocion 5.0) — a notification as a text to the mobile number on
 * the person's profile (`user.phone`, kept by `me.set_phone`), sent from the
 * number the workspace texts from: the account's shared number when it has one
 * (`answers: "sender"`, so a reply reaches the person's own assistant), else
 * the workspace's own. Through the SMS surface's Twilio account
 * (`libs/surfaces/sms.ts`); without it the channel is "not configured". Off by
 * default for every kind (`CHANNEL_DEFAULTS`).
 */

/**
 * Whether this server can text at all.
 * @param env - The environment.
 */
export function smsConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.TWILIO_ACCOUNT_SID?.trim() && env.TWILIO_AUTH_TOKEN?.trim());
}

/**
 * The words of a notification as one text: title, body, link, within `SMS_MAX`.
 * The link survives a long body, because the link is what the text is for.
 * @param message - The notification.
 */
export function smsNotificationText(message: NotificationMessage): string {
  const link = message.url ?? '';
  const head = [message.title, message.body].filter(Boolean).join('\n');
  const room = SMS_MAX - (link ? link.length + 1 : 0);
  const cut = head.length > room ? `${head.slice(0, Math.max(0, room - 1)).trimEnd()}…` : head;
  return smsText([cut, link].filter(Boolean).join('\n'));
}

/**
 * Send one notification as a text.
 * @param target - From the workspace's number, to the person's.
 * @param target.from - The number Vocion texts from (E.164).
 * @param target.to - The person's number (E.164).
 * @param message - What to say.
 * @param send - The sender; Twilio by default (`sendSms`).
 */
export async function sendSmsNotification(
  target: { from: string; to: string },
  message: NotificationMessage,
  send?: (from: string, to: string, body: string) => Promise<unknown>,
): Promise<ChannelOutcome> {
  if (!smsConfigured()) {
    return { status: 'not_configured', error: 'this server has no Twilio account (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)' };
  }
  const deliver = send ?? (await import('@/libs/surfaces/sms')).sendSms;
  try {
    await deliver(target.from, target.to, smsNotificationText(message));
    return { status: 'sent' };
  } catch (error) {
    // Twilio refusing is worth another go; a bad number is said by Twilio in words and retried
    // to the backoff's end, which is cheaper than guessing which of its errors are permanent.
    return { status: 'retry', error: `Twilio: ${error instanceof Error ? error.message : String(error)}` };
  }
}
