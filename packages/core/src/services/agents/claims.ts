/**
 * TenantClaim — the signed capability that carries tenant context across
 * the agent-runtime transport seam.
 *
 * vocion-core mints one per invocation (chat turn / mission run) and the
 * runtime artifact forwards it, opaquely, on every tool call. The tool
 * endpoint verifies the signature and builds the tool RuntimeContext
 * FROM THE CLAIM — never from anything the model or the artifact says.
 * That keeps tenancy enforcement exactly as trustworthy as it is
 * in-process today: the only party who can name an org is core itself.
 *
 * Format: base64url(JSON payload) + '.' + base64url(HMAC-SHA256).
 * Deliberately not JWT — no alg negotiation, no external deps, nothing
 * to misconfigure. Secret: VOCION_TOOL_SIGNING_SECRET, falling back to
 * AUTH_SECRET so dev needs no new env.
 */

import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

export type TenantClaim = {
  orgId: string;
  agentSlug: string;
  userId?: string;
  /** Per-user source ACL for this request (SourceAccessService). */
  allowedSourceSlugs?: string[];
  /** Mission scope for mission-run tools. */
  missionSlug?: string;
  /** Unix ms expiry. Claims are per-invocation and short-lived. */
  exp: number;
};

/** Default lifetime: generous enough for a long agent run, short enough to be useless if leaked. */
const DEFAULT_TTL_MS = 30 * 60 * 1000;

function secret(): string {
  const s = process.env.VOCION_TOOL_SIGNING_SECRET || process.env.AUTH_SECRET;
  if (!s) {
    throw new Error('claims: VOCION_TOOL_SIGNING_SECRET or AUTH_SECRET must be set');
  }
  return s;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function hmac(data: string): Buffer {
  return createHmac('sha256', secret()).update(data).digest();
}

export function signClaim(claim: Omit<TenantClaim, 'exp'> & { exp?: number }): string {
  const payload: TenantClaim = { ...claim, exp: claim.exp ?? Date.now() + DEFAULT_TTL_MS };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${body}.${b64url(hmac(body))}`;
}

export type ClaimVerification
  = | { ok: true; claim: TenantClaim }
    | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function verifyClaim(token: string): ClaimVerification {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) {
    return { ok: false, reason: 'malformed' };
  }
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let expected: Buffer;
  let provided: Buffer;
  try {
    expected = hmac(body);
    provided = Buffer.from(sig, 'base64url');
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let claim: TenantClaim;
  try {
    claim = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TenantClaim;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!claim.orgId || !claim.agentSlug || typeof claim.exp !== 'number') {
    return { ok: false, reason: 'malformed' };
  }
  if (Date.now() > claim.exp) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, claim };
}
