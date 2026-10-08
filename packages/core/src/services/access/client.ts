/**
 * The client fingerprint an access event carries: a keyed hash of the caller's
 * IP address and of its user agent, never either value itself.
 *
 * Keyed, not a plain digest, because the IPv4 space is small enough to
 * enumerate: a bare SHA-256 of an address is the address. The key is the
 * deployment's auth secret under its own domain label, so the same address
 * hashes the same way across rows (an admin can see "the same machine") and
 * nobody without the secret can reverse it. No secret configured means no
 * hash at all, rather than one anybody could invert.
 */

import type { AccessClient } from './accessLog';
import { createHmac } from 'node:crypto';
import process from 'node:process';

/** Hex characters kept: 128 bits, plenty to tell machines apart. */
const HASH_LENGTH = 32;

function key(): string | null {
  return process.env.AUTH_SECRET || process.env.VOCION_TOOL_SIGNING_SECRET || null;
}

/**
 * The keyed hash of one client value, or null when there is no value or no key.
 * @param label - Which value this is, so an address and an agent string never collide.
 * @param value - The raw value.
 */
export function hashClientValue(label: 'ip' | 'ua', value: string | null | undefined): string | null {
  const v = value?.trim();
  const k = key();
  if (!v || !k) {
    return null;
  }
  return createHmac('sha256', k).update(`access-log:${label}:${v}`).digest('hex').slice(0, HASH_LENGTH);
}

/**
 * The fingerprint of a request, from its headers. The address is the first hop
 * a proxy recorded (`x-forwarded-for`), else `x-real-ip`.
 * @param headers - The request's headers; null outside a request.
 */
export function clientOf(headers: Pick<Headers, 'get'> | null | undefined): AccessClient | null {
  if (!headers) {
    return null;
  }
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0];
  const ip = forwarded?.trim() || headers.get('x-real-ip');
  const ipHash = hashClientValue('ip', ip);
  const uaHash = hashClientValue('ua', headers.get('user-agent'));
  return ipHash || uaHash ? { ipHash, uaHash } : null;
}

/**
 * The fingerprint of the request being served, for a server component or an
 * RPC handler that holds no `Request`. Null outside a request (a script, the
 * durable worker), never a throw.
 */
export async function currentRequestClient(): Promise<AccessClient | null> {
  try {
    const { headers } = await import('next/headers');
    return clientOf(await headers());
  } catch {
    return null;
  }
}
