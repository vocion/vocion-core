/**
 * SIGN IN FROM AN ASSISTANT — OAuth 2.1 for MCP clients (backlog 027).
 *
 * Claude.ai, Claude Desktop, Claude Code, ChatGPT and Cursor add a server by
 * URL and expect the rest to follow from the spec: discovery documents name
 * the endpoints, the client registers itself (RFC 7591), sends the person
 * to `/oauth/authorize` with a PKCE challenge (S256, required), the person
 * approves the client in the app, and the code comes back to `/oauth/token`
 * for an access token. Here the access token IS a Vocion API token
 * (`vcn_live_…`, 30 days), so `/api/mcp` and the write API authenticate it
 * the way they already do, and revoking it under Settings → API cuts the
 * assistant off at once.
 *
 * Deliberately small, after Slate's connector (2026-09-25): public clients
 * only (no secrets — the redirect list is the identity), one workspace per
 * approval (the person's active one), no refresh tokens yet (a 30-day token
 * and a sign-in again). Anything a tool does runs as the token's principal.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { oauthClientSchema, oauthRequestSchema } from '@/models/Schema';
import { issueToken } from '@/services/ApiTokenService';

const REQUEST_TTL_MS = 10 * 60 * 1000;
const ACCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REDIRECTS = 10;

export class OAuthError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
  }
}

/**
 * The discovery documents, for the origin the request arrived on.
 * @param origin
 */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['workspace'],
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
    scopes_supported: ['workspace'],
  };
}

/**
 * A redirect address a client may register: https anywhere, plain http only
 * on the loopback (a CLI's local listener), or a custom app scheme.
 * @param uri - The candidate.
 */
export function redirectAllowed(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.protocol === 'https:') {
    return true;
  }
  if (u.protocol === 'http:') {
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  }
  return /^[a-z][a-z0-9+.-]*:$/i.test(u.protocol) && u.protocol !== 'javascript:';
}

/**
 * A registered loopback address matches any port (RFC 8252 §7.3); anything else matches exactly.
 * @param registered
 * @param given
 */
export function redirectMatches(registered: string, given: string): boolean {
  if (registered === given) {
    return true;
  }
  try {
    const a = new URL(registered);
    const b = new URL(given);
    const loopback = a.protocol === 'http:' && (a.hostname === 'localhost' || a.hostname === '127.0.0.1');
    return loopback && a.protocol === b.protocol && a.hostname === b.hostname && a.pathname === b.pathname;
  } catch {
    return false;
  }
}

/**
 * Dynamic client registration. Returns what the client sends back on every
 * later request: its id and the redirects it may use.
 * @param input - The registration body, as the client sent it.
 */
export async function registerClient(input: Record<string, unknown>) {
  const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
  if (uris.length === 0 || uris.length > MAX_REDIRECTS || !uris.every(redirectAllowed)) {
    throw new OAuthError('invalid_redirect_uri', 'redirect_uris must list one to ten https, loopback http, or app-scheme addresses.');
  }
  const name = typeof input.client_name === 'string' && input.client_name.trim() ? input.client_name.trim().slice(0, 120) : 'An assistant';
  const id = `oc_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  await db.insert(oauthClientSchema).values({ id, name, redirectUris: uris });
  return {
    client_id: id,
    client_name: name,
    redirect_uris: uris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
  };
}

export type AuthorizeParams = {
  client_id?: string;
  redirect_uri?: string;
  response_type?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  state?: string;
  scope?: string;
};

/**
 * Start a sign-in: check the client and the redirect, keep the PKCE
 * challenge, and hand back the request the consent page shows.
 * @param q - The authorize query.
 */
export async function beginAuthorization(q: AuthorizeParams) {
  const client = q.client_id ? (await db.select().from(oauthClientSchema).where(eq(oauthClientSchema.id, q.client_id)).limit(1))[0] : undefined;
  if (!client) {
    throw new OAuthError('invalid_client', 'No such client. Register first at /oauth/register.', 400);
  }
  const redirectUri = q.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
  if (!redirectUri || !client.redirectUris.some(r => redirectMatches(r, redirectUri))) {
    throw new OAuthError('invalid_request', 'redirect_uri is not one this client registered.');
  }
  if ((q.response_type ?? 'code') !== 'code') {
    throw new OAuthError('unsupported_response_type', 'Only response_type=code is supported.');
  }
  if (!q.code_challenge) {
    throw new OAuthError('invalid_request', 'A PKCE code_challenge is required.');
  }
  if ((q.code_challenge_method ?? 'plain') !== 'S256') {
    throw new OAuthError('invalid_request', 'code_challenge_method must be S256.');
  }
  const id = `or_${randomUUID().replace(/-/g, '')}`;
  await db.insert(oauthRequestSchema).values({
    id,
    clientId: client.id,
    redirectUri,
    codeChallenge: q.code_challenge,
    state: q.state ?? null,
    scope: q.scope ?? null,
    expiresAt: new Date(Date.now() + REQUEST_TTL_MS),
  });
  return { id, clientName: client.name, redirectUri };
}

/**
 * The pending request a consent page shows, or null when it is gone or spent.
 * @param id
 */
export async function pendingRequest(id: string) {
  const [row] = await db.select().from(oauthRequestSchema).where(and(eq(oauthRequestSchema.id, id), eq(oauthRequestSchema.status, 'pending'), gt(oauthRequestSchema.expiresAt, new Date()))).limit(1);
  if (!row) {
    return null;
  }
  const [client] = await db.select().from(oauthClientSchema).where(eq(oauthClientSchema.id, row.clientId)).limit(1);
  return { ...row, clientName: client?.name ?? 'An assistant' };
}

/**
 * The person approved: stamp who and which workspace, mint the code, and say
 * where to send them.
 * @param input - The request and the approver.
 * @param input.id
 * @param input.userId
 * @param input.orgId
 */
export async function approveRequest(input: { id: string; userId: string; orgId: string }): Promise<{ redirectTo: string }> {
  const row = await pendingRequest(input.id);
  if (!row) {
    throw new OAuthError('invalid_request', 'This sign-in request has expired. Start again from the assistant.', 410);
  }
  const code = randomBytes(32).toString('base64url');
  await db.update(oauthRequestSchema).set({ userId: input.userId, orgId: input.orgId, code, status: 'approved' }).where(eq(oauthRequestSchema.id, row.id));
  const to = new URL(row.redirectUri);
  to.searchParams.set('code', code);
  if (row.state) {
    to.searchParams.set('state', row.state);
  }
  return { redirectTo: to.toString() };
}

/**
 * The person declined: send them back with the standard error.
 * @param id
 */
export async function denyRequest(id: string): Promise<{ redirectTo: string } | null> {
  const row = await pendingRequest(id);
  if (!row) {
    return null;
  }
  await db.update(oauthRequestSchema).set({ status: 'denied' }).where(eq(oauthRequestSchema.id, row.id));
  const to = new URL(row.redirectUri);
  to.searchParams.set('error', 'access_denied');
  if (row.state) {
    to.searchParams.set('state', row.state);
  }
  return { redirectTo: to.toString() };
}

/**
 * The code comes back with the PKCE verifier; it becomes a Vocion API token
 * for the workspace the person approved. Once: the code is cleared as it is
 * spent.
 * @param body - The token request body.
 */
export async function exchangeCode(body: Record<string, unknown>) {
  if (body.grant_type !== 'authorization_code') {
    throw new OAuthError('unsupported_grant_type', 'Only authorization_code is supported.');
  }
  const code = typeof body.code === 'string' ? body.code : '';
  const verifier = typeof body.code_verifier === 'string' ? body.code_verifier : '';
  if (!code || !verifier) {
    throw new OAuthError('invalid_request', 'code and code_verifier are required.');
  }
  const [row] = await db.select().from(oauthRequestSchema).where(and(eq(oauthRequestSchema.code, code), eq(oauthRequestSchema.status, 'approved'), gt(oauthRequestSchema.expiresAt, new Date()))).limit(1);
  if (!row || !row.orgId || !row.userId) {
    throw new OAuthError('invalid_grant', 'The code is unknown, spent, or expired.');
  }
  if (typeof body.client_id === 'string' && body.client_id !== row.clientId) {
    throw new OAuthError('invalid_grant', 'The code was issued to a different client.');
  }
  if (typeof body.redirect_uri === 'string' && !redirectMatches(row.redirectUri, body.redirect_uri)) {
    throw new OAuthError('invalid_grant', 'redirect_uri does not match the one the code was issued for.');
  }
  const expected = createHash('sha256').update(verifier).digest('base64url');
  if (expected !== row.codeChallenge) {
    throw new OAuthError('invalid_grant', 'The PKCE verifier does not match the challenge.');
  }
  // Spent before minting, so a retried exchange cannot mint twice.
  await db.update(oauthRequestSchema).set({ code: null, status: 'exchanged' }).where(eq(oauthRequestSchema.id, row.id));
  const [client] = await db.select().from(oauthClientSchema).where(eq(oauthClientSchema.id, row.clientId)).limit(1);
  const expiresAt = new Date(Date.now() + ACCESS_TTL_MS);
  const issued = await issueToken({ orgId: row.orgId, name: `${client?.name ?? 'Assistant'} (connector)`, createdBy: row.userId, role: 'pm', expiresAt });
  return {
    access_token: issued.token,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    scope: row.scope ?? 'workspace',
  };
}
