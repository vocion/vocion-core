import type { ChannelOutcome, NotificationMessage } from './outcome';
import process from 'node:process';
import webpush from 'web-push';

/**
 * WEB PUSH TO CHROME (backlog 048) — the Push API with VAPID, through the
 * `web-push` library. The keys are the deployment's own identity to the push
 * services, not a vendor account an org pays for, so they are read from the
 * environment (never logged):
 *
 *   VOCION_VAPID_PUBLIC_KEY   the application server key the browser subscribes with
 *   VOCION_VAPID_PRIVATE_KEY  signs each push
 *   VOCION_VAPID_SUBJECT      `mailto:` or `https:` contact the push service may use (default: the app URL)
 *
 * Generate a pair once with `npx web-push generate-vapid-keys`. With either
 * key unset the channel reports "not configured"; nothing else changes.
 */

export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

/**
 * The VAPID identity, or null when the deployment has none.
 * @param env
 */
export function vapidConfig(env: Record<string, string | undefined> = process.env): VapidConfig | null {
  const publicKey = env.VOCION_VAPID_PUBLIC_KEY?.trim() ?? '';
  const privateKey = env.VOCION_VAPID_PRIVATE_KEY?.trim() ?? '';
  if (!publicKey || !privateKey) {
    return null;
  }
  // The push services accept only an https: or mailto: contact; an http://
  // app URL (local dev) would fail every send, so it is not used as one.
  const appUrl = (env.NEXT_PUBLIC_APP_URL?.trim() ?? '').replace(/\/$/, '');
  const subject = env.VOCION_VAPID_SUBJECT?.trim() || (appUrl.startsWith('https://') ? appUrl : 'mailto:notifications@vocion.invalid');
  return { publicKey, privateKey, subject };
}

export type WebSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };

type Sender = typeof webpush.sendNotification;

/**
 * Send one notification to one browser subscription.
 * @param sub - The stored subscription.
 * @param message - What to show.
 * @param config - The deployment's VAPID identity, or null.
 * @param send - The library call, injectable for tests.
 */
export async function sendWebPush(sub: WebSubscription, message: NotificationMessage, config: VapidConfig | null, send: Sender = webpush.sendNotification): Promise<ChannelOutcome> {
  if (!config) {
    return { status: 'not_configured', error: 'Chrome notifications are not configured on this server (VOCION_VAPID_PUBLIC_KEY / VOCION_VAPID_PRIVATE_KEY)' };
  }
  // The service worker (`public/notifications-sw.js`) reads exactly these keys.
  const payload = JSON.stringify({ id: message.id, kind: message.kind, title: message.title, body: message.body ?? '', url: message.url });
  try {
    await send(sub, payload, {
      vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
      TTL: 24 * 60 * 60,
      urgency: 'high',
    });
    return { status: 'sent' };
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      return { status: 'gone', error: `the browser's subscription has expired (${status})` };
    }
    if (status === undefined || status === 429 || status >= 500) {
      return { status: 'retry', error: status ? `the push service answered ${status}` : `could not reach the push service: ${(err as Error).message}` };
    }
    return { status: 'failed', error: `the push service refused the notification (${status})` };
  }
}
