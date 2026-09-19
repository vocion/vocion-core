/**
 * PKCE and the anti-forgery state, as the RFC describes them.
 *
 * `state` is not decorative. The callback is a GET anybody can hand the
 * browser, so without a value this side minted and stored, a link could make a
 * signed-in person bind an attacker's account to their workspace. The stored
 * row is what makes the callback answerable: it carries who started the flow,
 * which connector for, and the verifier that proves the exchange belongs to
 * the same consent.
 */

import type { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';

/**
 * URL-safe base64 with no padding — what every OAuth spec means by base64url.
 * @param buf
 */
function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/** An opaque, unguessable value. 32 bytes of CSPRNG output. */
export function randomToken(): string {
  return b64url(randomBytes(32));
}

/**
 * A PKCE verifier and the challenge derived from it.
 *
 * S256 only: the `plain` method offers no protection at all, and every
 * provider here supports S256.
 */
export function pkcePair(): { verifier: string; challenge: string; method: 'S256' } {
  const verifier = randomToken();
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge, method: 'S256' };
}
