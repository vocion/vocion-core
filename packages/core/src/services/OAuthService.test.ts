/**
 * An assistant signs in the way the spec says (backlog 027): registers, is
 * approved by a person for one workspace, exchanges the code once with the
 * PKCE verifier, and gets a Vocion token that /api/mcp accepts.
 */
import { createHash, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { apiTokenSchema, oauthClientSchema, oauthRequestSchema } = await import('@/models/Schema');
const { approveRequest, beginAuthorization, denyRequest, exchangeCode, OAuthError, pendingRequest, redirectAllowed, registerClient } = await import('./OAuthService');
const { authenticateBearer } = await import('./ApiTokenService');

const ORG = 'org_connector_027';
const USER = 'usr-connector';
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');

async function signIn(redirect = 'https://claude.ai/api/mcp/auth_callback') {
  const client = await registerClient({ client_name: 'Claude', redirect_uris: [redirect] });
  const started = await beginAuthorization({ client_id: client.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz' });
  return { client, started };
}

describe('sign in from an assistant', () => {
  beforeEach(async () => {
    await db.delete(oauthRequestSchema);
    await db.delete(oauthClientSchema);
    await db.delete(apiTokenSchema);
  });

  it('registers a client, takes the person through consent, and turns the code into a token /api/mcp accepts', async () => {
    const { client, started } = await signIn();

    expect(client.client_id).toMatch(/^oc_/);
    expect(started.clientName).toBe('Claude');
    expect((await pendingRequest(started.id))?.clientName).toBe('Claude');

    const approved = await approveRequest({ id: started.id, userId: USER, orgId: ORG });
    const back = new URL(approved.redirectTo);

    expect(back.origin + back.pathname).toBe('https://claude.ai/api/mcp/auth_callback');
    expect(back.searchParams.get('state')).toBe('xyz');

    const code = back.searchParams.get('code')!;

    const token = await exchangeCode({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback' });

    expect(token.access_token).toMatch(/^vcn_live_/);
    expect(token.token_type).toBe('Bearer');

    const identity = await authenticateBearer(`Bearer ${token.access_token}`);

    expect(identity?.orgId).toBe(ORG);
    // Once only.
    await expect(exchangeCode({ grant_type: 'authorization_code', code, code_verifier: verifier })).rejects.toThrow(/unknown, spent, or expired/);
  });

  it('refuses a wrong verifier, a foreign redirect, a plain challenge and a decline', async () => {
    const { client, started } = await signIn();
    const approved = await approveRequest({ id: started.id, userId: USER, orgId: ORG });
    const code = new URL(approved.redirectTo).searchParams.get('code')!;

    await expect(exchangeCode({ grant_type: 'authorization_code', code, code_verifier: 'not-it' })).rejects.toThrow(/verifier does not match/);
    await expect(beginAuthorization({ client_id: client.client_id, redirect_uri: 'https://evil.example/cb', code_challenge: challenge, code_challenge_method: 'S256' })).rejects.toThrow(/not one this client registered/);
    await expect(beginAuthorization({ client_id: client.client_id, code_challenge: challenge, code_challenge_method: 'plain' })).rejects.toThrow(/must be S256/);
    await expect(registerClient({ redirect_uris: ['http://attacker.example/cb'] })).rejects.toThrow(OAuthError);
    expect(redirectAllowed('http://localhost:8080/cb')).toBe(true);
    expect(redirectAllowed('http://attacker.example/cb')).toBe(false);

    const again = await signIn();
    const denied = await denyRequest(again.started.id);

    expect(new URL(denied!.redirectTo).searchParams.get('error')).toBe('access_denied');
  });
});
