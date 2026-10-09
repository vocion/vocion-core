/**
 * A brief's MP3, fetchable without signing in, for the one caller that cannot
 * sign in: a carrier fetching a text's attachment (Twilio's `MediaUrl`). The
 * link names one brief in one workspace and expires; it is signed with
 * `AUTH_SECRET` like the push stop link (`libs/personal/stopLink.ts`).
 * Whoever holds it can play that one brief until it expires, which is what
 * attaching the file to a text grants anyway.
 */

import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Env } from '@/libs/Env';

/** Where the public listen route is mounted (`app/api/listen/[...path]`). */
export const LISTEN_ROUTE_BASE = '/api/listen';

/** A text's attachment is fetched within seconds; a day covers a carrier's retries. */
export const CLIP_TTL_MS = 24 * 60 * 60 * 1000;

export type ClipClaim = { orgId: string; briefingId: number; exp: number };

function mac(payload: string): string {
  const secret = Env.AUTH_SECRET;
  if (!secret) {
    throw new Error('listen links need AUTH_SECRET');
  }
  return createHmac('sha256', secret).update(`brief-clip:${payload}`).digest('base64url');
}

/**
 * A signed token for one brief's MP3.
 * @param claim - Which brief, until when (epoch ms).
 */
export function clipToken(claim: ClipClaim): string {
  const payload = Buffer.from(JSON.stringify([claim.orgId, claim.briefingId, claim.exp]), 'utf8').toString('base64url');
  return `${payload}.${mac(payload)}`;
}

/**
 * The path a clip is served at.
 * @param claim - Which brief, until when.
 */
export function clipPath(claim: ClipClaim): string {
  return `${LISTEN_ROUTE_BASE}/clip/${clipToken(claim)}.mp3`;
}

/**
 * The claim a token carries, or null when it is not one this server signed or it expired.
 * @param token - From the link, with or without `.mp3`.
 * @param now - The clock.
 */
export function readClipToken(token: string | null | undefined, now: number = Date.now()): ClipClaim | null {
  const t = (token ?? '').replace(/\.mp3$/, '');
  if (!t || t.length > 600) {
    return null;
  }
  const [payload, sig] = t.split('.');
  if (!payload || !sig) {
    return null;
  }
  let wanted: Buffer;
  try {
    wanted = Buffer.from(mac(payload));
  } catch {
    return null;
  }
  const given = Buffer.from(sig);
  if (wanted.length !== given.length || !timingSafeEqual(wanted, given)) {
    return null;
  }
  try {
    const [orgId, briefingId, exp] = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as [unknown, unknown, unknown];
    if (typeof orgId !== 'string' || typeof briefingId !== 'number' || typeof exp !== 'number' || exp < now) {
      return null;
    }
    return { orgId, briefingId, exp };
  } catch {
    return null;
  }
}
