/**
 * Signing a person in to a remote MCP server's own OAuth (MCP authorization:
 * protected-resource discovery, dynamic client registration, PKCE).
 *
 * Vocion registers itself as a public client per sign-in, so nothing secret
 * has to survive between the start and the callback: the client id rides in
 * the signed connect state and the PKCE verifier is derived from that state
 * (`libs/connect/state.ts`). Every URL the server's metadata names is fetched
 * only when it is HTTPS and resolves publicly, and redirects are refused.
 */

import type { AuthorizationServerMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { discoverOAuthServerInfo, exchangeAuthorization, refreshAuthorization, registerClient } from '@modelcontextprotocol/sdk/client/auth.js';
import { grantExpiresAt } from '@/libs/connect/loginGrant';
import { resolvesPublicly } from '@/libs/net/publicUrl';

/** What a person's sign-in to an MCP server keeps, sealed in their own vault. */
export type McpGrant = {
  /** The MCP endpoint the grant is for; `mcpCredentialsOf` reads it with `token`. */
  baseUrl: string;
  token: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  clientId: string;
  resource: string;
};

/** The server's authorization setup, as discovery found it. */
export type McpAuthServer = {
  authorizationServerUrl: string;
  metadata: AuthorizationServerMetadata;
  resource: string;
  scope?: string;
};

/**
 * The one spelling of an endpoint a grant is stored and found under.
 * @param url - The endpoint as configured.
 */
export function mcpEndpoint(url: string): string {
  return new URL(url).toString();
}

/** Access tokens without `expires_in` are refreshed after an hour. */
const DEFAULT_EXPIRES_IN_SECONDS = 3600;

/**
 * Fetch that only reaches public HTTPS hosts and never follows a redirect.
 * @param input - The URL.
 * @param init - The request.
 */
const publicFetch: FetchLike = async (input, init) => {
  const url = input.toString();
  if (!url.startsWith('https://') || !(await resolvesPublicly(url)).ok) {
    throw new Error('The MCP server named an authorization URL that is not public HTTPS.');
  }
  return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) });
};

/**
 * Discover how the MCP server at `baseUrl` signs people in.
 * @param baseUrl - The MCP endpoint.
 */
export async function discoverMcpAuth(baseUrl: string): Promise<McpAuthServer> {
  const info = await discoverOAuthServerInfo(baseUrl, { fetchFn: publicFetch });
  if (!info.authorizationServerMetadata) {
    throw new Error('The MCP server publishes no OAuth metadata.');
  }
  const scopes = info.resourceMetadata?.scopes_supported;
  return {
    authorizationServerUrl: info.authorizationServerUrl,
    metadata: info.authorizationServerMetadata,
    resource: info.resourceMetadata?.resource ?? baseUrl,
    ...(scopes?.length ? { scope: scopes.join(' ') } : {}),
  };
}

/**
 * Register Vocion as a public client for one sign-in.
 * @param server - The discovered setup.
 * @param redirectUri - Vocion's callback.
 * @returns The client id.
 */
export async function registerMcpClient(server: McpAuthServer, redirectUri: string): Promise<string> {
  if (!server.metadata.registration_endpoint) {
    throw new Error('The MCP server does not allow dynamic client registration.');
  }
  const client = await registerClient(server.authorizationServerUrl, {
    metadata: server.metadata,
    clientMetadata: {
      client_name: 'Vocion',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    ...(server.scope ? { scope: server.scope } : {}),
    fetchFn: publicFetch,
  });
  if (client.client_secret) {
    // A secret could not ride in the unencrypted state, and a public client has none.
    throw new Error('The MCP server registered a confidential client; Vocion signs in as a public client.');
  }
  return client.client_id;
}

/**
 * The URL that sends the person to the server's sign-in.
 * @param server - The discovered setup.
 * @param input - The client, callback, signed state and PKCE challenge.
 * @param input.clientId - From `registerMcpClient`.
 * @param input.redirectUri - Vocion's callback.
 * @param input.state - The signed connect state.
 * @param input.codeChallenge - S256 challenge of the state's verifier.
 */
export function mcpAuthorizeUrl(server: McpAuthServer, input: { clientId: string; redirectUri: string; state: string; codeChallenge: string }): string {
  const methods = server.metadata.code_challenge_methods_supported;
  if (methods && !methods.includes('S256')) {
    throw new Error('The MCP server does not support PKCE with S256.');
  }
  const url = new URL(server.metadata.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('resource', server.resource);
  if (server.scope) {
    url.searchParams.set('scope', server.scope);
  }
  return url.toString();
}

/**
 * The grant a token response makes. A server that rotates nothing keeps the
 * refresh token it had.
 * @param baseUrl - The MCP endpoint.
 * @param server - The discovered setup.
 * @param clientId - The registered client.
 * @param tokens - The token response.
 * @param previousRefreshToken - The refresh token spent, when refreshing.
 */
function grantFrom(baseUrl: string, server: McpAuthServer, clientId: string, tokens: OAuthTokens, previousRefreshToken?: string): McpGrant {
  const refreshToken = tokens.refresh_token ?? previousRefreshToken;
  if (!refreshToken) {
    throw new Error('The MCP server issued no refresh token, so the sign-in could not outlive its first hour.');
  }
  return {
    baseUrl,
    token: tokens.access_token,
    accessToken: tokens.access_token,
    refreshToken,
    expiresAt: grantExpiresAt(tokens.expires_in, DEFAULT_EXPIRES_IN_SECONDS),
    clientId,
    resource: server.resource,
  };
}

/**
 * Trade the callback's code for the person's grant.
 * @param input - The endpoint, client, code and PKCE verifier.
 * @param input.baseUrl - The MCP endpoint.
 * @param input.clientId - The client registered at start.
 * @param input.code - The authorization code.
 * @param input.codeVerifier - The state's PKCE verifier.
 * @param input.redirectUri - Vocion's callback, as sent at start.
 */
export async function exchangeMcpCode(input: { baseUrl: string; clientId: string; code: string; codeVerifier: string; redirectUri: string }): Promise<McpGrant> {
  const server = await discoverMcpAuth(input.baseUrl);
  const tokens = await exchangeAuthorization(server.authorizationServerUrl, {
    metadata: server.metadata,
    clientInformation: { client_id: input.clientId },
    authorizationCode: input.code,
    codeVerifier: input.codeVerifier,
    redirectUri: input.redirectUri,
    resource: new URL(server.resource),
    fetchFn: publicFetch,
  });
  return grantFrom(input.baseUrl, server, input.clientId, tokens);
}

/**
 * A fresh grant from the stored one's refresh token.
 * @param grant - The stored grant.
 */
export async function refreshMcpGrant(grant: McpGrant): Promise<McpGrant> {
  const server = await discoverMcpAuth(grant.baseUrl);
  const tokens = await refreshAuthorization(server.authorizationServerUrl, {
    metadata: server.metadata,
    clientInformation: { client_id: grant.clientId },
    refreshToken: grant.refreshToken,
    resource: new URL(grant.resource),
    fetchFn: publicFetch,
  });
  return grantFrom(grant.baseUrl, server, grant.clientId, tokens, grant.refreshToken);
}

/**
 * The stored bag as a grant, or null when it is not one.
 * @param values - A decrypted credential bag.
 */
export function asMcpGrant(values: Record<string, unknown>): McpGrant | null {
  const keys = ['baseUrl', 'token', 'accessToken', 'refreshToken', 'expiresAt', 'clientId', 'resource'] as const;
  return keys.every(key => typeof values[key] === 'string' && values[key] !== '') ? values as unknown as McpGrant : null;
}
