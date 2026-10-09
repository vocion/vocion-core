/**
 * The one-tap "stop these" in every push (docs/guides/push-to-you.md).
 *
 * A push leaves the app, so its stop link must work without signing in: the
 * link carries a token naming the person, their Org and the channel, signed
 * with `AUTH_SECRET`. Whoever holds the link can only turn that one channel
 * off for that one person, which is exactly what an unsubscribe link grants.
 * It never expires: an old mail's footer must still stop the mail.
 */

import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Env } from '@/libs/Env';

export const PUSH_CHANNELS = ['slack', 'sms', 'email'] as const;
export type PushChannel = typeof PUSH_CHANNELS[number];

export type StopClaim = { userId: string; accountId: string; channel: PushChannel };

function key(): string {
  const secret = Env.AUTH_SECRET;
  if (!secret) {
    throw new Error('stop links need AUTH_SECRET');
  }
  return secret;
}

function mac(payload: string): string {
  return createHmac('sha256', key()).update(`push-stop:${payload}`).digest('base64url');
}

/**
 * A signed token for one person's one channel.
 * @param claim - Whose channel.
 */
export function stopToken(claim: StopClaim): string {
  const payload = Buffer.from(JSON.stringify([claim.userId, claim.accountId, claim.channel]), 'utf8').toString('base64url');
  return `${payload}.${mac(payload)}`;
}

/**
 * The claim a token carries, or null when it is not one this server signed.
 * @param token - From the link.
 */
export function readStopToken(token: string | null | undefined): StopClaim | null {
  if (!token || token.length > 600) {
    return null;
  }
  const [payload, sig] = token.split('.');
  if (!payload || !sig) {
    return null;
  }
  const wanted = Buffer.from(mac(payload));
  const given = Buffer.from(sig);
  if (wanted.length !== given.length || !timingSafeEqual(wanted, given)) {
    return null;
  }
  try {
    const [userId, accountId, channel] = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as [unknown, unknown, unknown];
    if (typeof userId !== 'string' || typeof accountId !== 'string' || !PUSH_CHANNELS.includes(channel as PushChannel)) {
      return null;
    }
    return { userId, accountId, channel: channel as PushChannel };
  } catch {
    return null;
  }
}
