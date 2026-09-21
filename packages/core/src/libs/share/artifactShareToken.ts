/**
 * The public link for an artifact shared with "anyone": a signed token naming
 * the artifact and its workspace. Stateless — the same HMAC discipline as
 * `services/agents/claims.ts`, keyed on the auth secret — and revocable by
 * changing the audience: the route that honours a token also checks that the
 * artifact is STILL shared with anyone, so an old link dies the moment the
 * owner narrows it. No expiry on the token itself: a link a person pasted
 * into a proposal thread should not rot on a timer they never set.
 */

import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import process from 'node:process';

export type ArtifactShareClaim = { artifactId: number; orgId: string; v: 1 };

function secret(): string {
  const s = process.env.VOCION_TOOL_SIGNING_SECRET || process.env.AUTH_SECRET;
  if (!s) {
    throw new Error('artifact share: VOCION_TOOL_SIGNING_SECRET or AUTH_SECRET must be set');
  }
  return s;
}

function hmac(data: string): Buffer {
  return createHmac('sha256', secret()).update(`artifact-share:${data}`).digest();
}

/**
 * Sign a public link for one artifact.
 * @param claim
 * @param claim.artifactId
 * @param claim.orgId
 */
export function signArtifactShare(claim: { artifactId: number; orgId: string }): string {
  const body = Buffer.from(JSON.stringify({ artifactId: claim.artifactId, orgId: claim.orgId, v: 1 } satisfies ArtifactShareClaim), 'utf8').toString('base64url');
  return `${body}.${hmac(body).toString('base64url')}`;
}

/**
 * Read a public link's token. Null for anything tampered, malformed or signed
 * under another secret — never a partial claim.
 * @param token
 */
export function verifyArtifactShare(token: string): ArtifactShareClaim | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) {
    return null;
  }
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expected: Buffer;
  try {
    expected = hmac(body);
  } catch {
    return null;
  }
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<ArtifactShareClaim>;
    if (parsed.v !== 1 || typeof parsed.artifactId !== 'number' || !Number.isInteger(parsed.artifactId) || parsed.artifactId <= 0 || typeof parsed.orgId !== 'string' || !parsed.orgId) {
      return null;
    }
    return { artifactId: parsed.artifactId, orgId: parsed.orgId, v: 1 };
  } catch {
    return null;
  }
}

/**
 * The relative public URL for a token.
 * @param token
 */
export function artifactSharePath(token: string): string {
  return `/share/a/${token}`;
}
