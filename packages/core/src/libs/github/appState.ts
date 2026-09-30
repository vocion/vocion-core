/**
 * The `state` Vocion hands GitHub on the app's two browser round trips
 * (backlog 053) — creating the app from a manifest, and installing it — and
 * reads back on the callback. Signed (HMAC-SHA256 on the auth secret, the
 * discipline of `libs/share/artifactShareToken.ts`), short-lived, and bound
 * to the person and workspace that started it, so a callback URL pasted into
 * another browser, or replayed after twenty minutes, does nothing.
 */

import { Buffer } from 'node:buffer';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import process from 'node:process';

export type GithubAppStatePurpose = 'manifest' | 'install';

export type GithubAppState = {
  purpose: GithubAppStatePurpose;
  orgId: string;
  userId: string;
  /** Seconds since the epoch. */
  exp: number;
  nonce: string;
  /** Install only: the installation GitHub named, carried through the identity check. */
  installationId?: number;
  /** Install only: where the person returns to (an app-relative path). */
  returnTo?: string;
};

const TTL_SECONDS = 20 * 60;

function key(): string {
  const s = process.env.VOCION_TOOL_SIGNING_SECRET || process.env.AUTH_SECRET;
  if (!s) {
    throw new Error('github app state: VOCION_TOOL_SIGNING_SECRET or AUTH_SECRET must be set');
  }
  return s;
}

function mac(body: string): Buffer {
  return createHmac('sha256', key()).update(`github-app-state:${body}`).digest();
}

/**
 * Sign a state for one round trip.
 * @param input - Who started it, for what.
 * @param now - Seconds since the epoch; for tests.
 */
export function signGithubAppState(input: Omit<GithubAppState, 'exp' | 'nonce'>, now = Math.floor(Date.now() / 1000)): string {
  const claim: GithubAppState = { ...input, exp: now + TTL_SECONDS, nonce: randomBytes(8).toString('base64url') };
  const body = Buffer.from(JSON.stringify(claim), 'utf8').toString('base64url');
  return `${body}.${mac(body).toString('base64url')}`;
}

/**
 * Read a state back. Null for anything tampered, expired, or for another purpose.
 * @param token - The state GitHub returned.
 * @param purpose - The round trip this callback ends.
 * @param now - Seconds since the epoch; for tests.
 */
export function verifyGithubAppState(token: string | null | undefined, purpose: GithubAppStatePurpose, now = Math.floor(Date.now() / 1000)): GithubAppState | null {
  if (!token) {
    return null;
  }
  const dot = token.lastIndexOf('.');
  if (dot <= 0) {
    return null;
  }
  const body = token.slice(0, dot);
  let expected: Buffer;
  try {
    expected = mac(body);
  } catch {
    return null;
  }
  const given = Buffer.from(token.slice(dot + 1), 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  try {
    const claim = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as GithubAppState;
    if (claim.purpose !== purpose || typeof claim.orgId !== 'string' || typeof claim.userId !== 'string' || typeof claim.exp !== 'number' || claim.exp < now) {
      return null;
    }
    return claim;
  } catch {
    return null;
  }
}
