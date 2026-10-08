/**
 * The client fingerprint an access event carries: a keyed hash of the caller's
 * IP address and of its user agent, never either value itself.
 *
 * Keyed, not a plain digest, because the IPv4 space is small enough to
 * enumerate: a bare SHA-256 of an address is the address. The key is the
 * deployment's auth secret under its own domain label, and the workspace is
 * part of what is hashed: the same address hashes the same way across one
 * workspace's rows (an admin can see "the same machine"), differently in every
 * other workspace (two tenants' logs, side by side, cannot be joined on a
 * machine), and nobody without the secret can reverse it. No secret configured
 * means no hash at all, rather than one anybody could invert.
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
 * The keyed hash of one client value inside one workspace, or null when there
 * is no value, no workspace or no key.
 * @param label - Which value this is, so an address and an agent string never collide.
 * @param value - The raw value.
 * @param orgId - The workspace whose log the hash goes into.
 */
export function hashClientValue(label: 'ip' | 'ua', value: string | null | undefined, orgId: string): string | null {
  const v = value?.trim();
  const k = key();
  if (!v || !k || !orgId) {
    return null;
  }
  return createHmac('sha256', k).update(`access-log:${label}:${orgId}:${v}`).digest('hex').slice(0, HASH_LENGTH);
}

/**
 * The fingerprint of a request, from its headers, for one workspace's log. The
 * address is the first hop a proxy recorded (`x-forwarded-for`), else
 * `x-real-ip`.
 * @param headers - The request's headers; null outside a request.
 * @param orgId - The workspace the read belongs to.
 */
export function clientOf(headers: Pick<Headers, 'get'> | null | undefined, orgId: string): AccessClient | null {
  if (!headers) {
    return null;
  }
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0];
  const ip = forwarded?.trim() || headers.get('x-real-ip');
  const ipHash = hashClientValue('ip', ip, orgId);
  const uaHash = hashClientValue('ua', headers.get('user-agent'), orgId);
  return ipHash || uaHash ? { ipHash, uaHash } : null;
}

/**
 * The fingerprint of the request being served, for a server component or an
 * RPC handler that holds no `Request`. Null outside a request (a script, the
 * durable worker), never a throw.
 * @param orgId - The workspace the read belongs to.
 */
export async function currentRequestClient(orgId: string): Promise<AccessClient | null> {
  try {
    const { headers } = await import('next/headers');
    return clientOf(await headers(), orgId);
  } catch {
    return null;
  }
}
