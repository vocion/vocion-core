/**
 * The `state` a vendor hands back unchanged: who started the connect, for
 * which source, and until when. Signed so the callback can trust it, and
 * bound to the org so a state minted in one workspace cannot land a
 * credential in another.
 *
 * Shape on the wire: base64url(payload JSON) + '.' + hex(HMAC-SHA256(payload)),
 * keyed with AUTH_SECRET. The nonce keeps two starts from ever producing the
 * same state; the expiry keeps a link pasted into a chat from working an hour
 * later.
 */

import { Buffer } from 'node:buffer';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Env } from '@/libs/Env';
import { safeReturnPath } from './returnTo';

export type ConnectStatePayload = {
  v: 1;
  provider: string;
  orgId: string;
  /** The source the login started from. Absent when it started from a connector alone (#1080). */
  sourceSlug?: string;
  /** The connector the login is for. Absent on a state signed before connectors could start a login. */
  connectorSlug?: string;
  userId: string;
  nonce: string;
  /** The chat conversation and card the login came from, so the callback can mark the card. */
  conversationId?: number;
  cardId?: string;
  /** Where to land afterwards: a `/dashboard` path, re-checked on verify. */
  returnTo?: string;
  /** Unix milliseconds. */
  exp: number;
};

export type ConnectStateRefusal = 'malformed' | 'bad_signature' | 'expired';

const TTL_MS = 10 * 60 * 1000;

/**
 * When a state was signed. The state carries only its expiry, and the lifetime
 * is fixed, so the start is the expiry minus the lifetime.
 * @param payload - A verified state.
 */
export function stateIssuedAt(payload: Pick<ConnectStatePayload, 'exp'>): Date {
  return new Date(payload.exp - TTL_MS);
}

function secret(): string {
  const value = Env.AUTH_SECRET;
  if (!value) {
    throw new Error('AUTH_SECRET is required to sign a connect state');
  }
  return value;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('hex');
}

/**
 * Mint a state for one connect attempt.
 * @param input - Who is connecting what.
 * @param input.provider - Provider id, e.g. `slack`.
 * @param input.orgId - The workspace the credential will belong to.
 * @param input.sourceSlug - The source being connected, when the login started from one.
 * @param input.connectorSlug - The connector being connected, when it started from a connector.
 * @param input.conversationId - The chat the login came from, if any.
 * @param input.cardId - The chat card the login came from, if any.
 * @param input.userId - The person who started it.
 * @param input.returnTo - Optional `/dashboard` path to land on afterwards.
 * @param now - Injected for tests.
 */
export function signState(
  input: {
    provider: string;
    orgId: string;
    sourceSlug?: string;
    connectorSlug?: string;
    userId: string;
    returnTo?: string;
    conversationId?: number;
    cardId?: string;
  },
  now: number = Date.now(),
): string {
  const payload: ConnectStatePayload = {
    v: 1,
    provider: input.provider,
    orgId: input.orgId,
    ...(input.sourceSlug ? { sourceSlug: input.sourceSlug } : {}),
    ...(input.connectorSlug ? { connectorSlug: input.connectorSlug } : {}),
    userId: input.userId,
    ...(input.returnTo ? { returnTo: input.returnTo } : {}),
    ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
    ...(input.cardId ? { cardId: input.cardId } : {}),
    nonce: randomBytes(16).toString('hex'),
    exp: now + TTL_MS,
  };
  const json = JSON.stringify(payload);
  return `${Buffer.from(json, 'utf8').toString('base64url')}.${sign(json)}`;
}

/**
 * Read a state back, or say why it cannot be trusted.
 * @param state - The value the vendor returned.
 * @param now - Injected for tests.
 */
export function verifyState(
  state: string | null | undefined,
  now: number = Date.now(),
): { ok: true; payload: ConnectStatePayload } | { ok: false; reason: ConnectStateRefusal } {
  if (!state || typeof state !== 'string') {
    return { ok: false, reason: 'malformed' };
  }
  const dot = state.lastIndexOf('.');
  if (dot <= 0 || dot === state.length - 1) {
    return { ok: false, reason: 'malformed' };
  }
  const encoded = state.slice(0, dot);
  const signature = state.slice(dot + 1);
  let json: string;
  try {
    json = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const expected = sign(json);
  const given = Buffer.from(signature, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return { ok: false, reason: 'bad_signature' };
  }
  let payload: ConnectStatePayload;
  try {
    payload = JSON.parse(json) as ConnectStatePayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (
    payload?.v !== 1
    || typeof payload.provider !== 'string'
    || typeof payload.orgId !== 'string'
    || (payload.sourceSlug !== undefined && typeof payload.sourceSlug !== 'string')
    || (payload.connectorSlug !== undefined && typeof payload.connectorSlug !== 'string')
    || (payload.sourceSlug === undefined && payload.connectorSlug === undefined)
    || (payload.conversationId !== undefined && !Number.isSafeInteger(payload.conversationId))
    || (payload.cardId !== undefined && typeof payload.cardId !== 'string')
    || typeof payload.userId !== 'string'
    || typeof payload.nonce !== 'string'
    || typeof payload.exp !== 'number'
  ) {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.returnTo !== undefined && safeReturnPath(payload.returnTo) === null) {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.exp <= now) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, payload };
}

/**
 * The PKCE code verifier for one login, derived from its signed state: an
 * HMAC of the state under AUTH_SECRET, base64url (43 characters, within
 * PKCE's 43 to 128). The start and the callback both hold the state, so both
 * reach the same verifier without storing it anywhere. Only the S256
 * challenge leaves the server; the verifier goes to the vendor's token
 * endpoint, server to server, and someone holding the state and the code
 * still cannot compute it without AUTH_SECRET.
 * @param state - The signed state, exactly as signed and as the vendor returned it.
 */
export function pkceVerifierFor(state: string): string {
  return createHmac('sha256', secret()).update(`pkce:${state}`).digest('base64url');
}

/**
 * The S256 code challenge for a verifier: base64url(SHA-256(verifier)).
 * @param verifier - From `pkceVerifierFor`.
 */
export function pkceChallengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
