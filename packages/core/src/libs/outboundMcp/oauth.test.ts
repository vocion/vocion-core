import type { McpAuthServer } from './oauth';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const { asMcpGrant, mcpAuthorizeUrl } = await import('./oauth');

const server: McpAuthServer = {
  authorizationServerUrl: 'https://knowledge.example',
  metadata: { issuer: 'https://knowledge.example', authorization_endpoint: 'https://knowledge.example/authorize', token_endpoint: 'https://knowledge.example/token', response_types_supported: ['code'], code_challenge_methods_supported: ['S256'] },
  resource: 'https://knowledge.example/mcp',
  scope: 'openid email',
};

describe('signing a person in to an MCP server', () => {
  it('sends the client, callback, state, S256 challenge, resource and scope', () => {
    const url = new URL(mcpAuthorizeUrl(server, { clientId: 'client-1', redirectUri: 'https://app.example/api/connect/mcp/callback', state: 'signed', codeChallenge: 'challenge' }));

    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: 'https://app.example/api/connect/mcp/callback',
      state: 'signed',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
      resource: 'https://knowledge.example/mcp',
      scope: 'openid email',
    });
  });

  it('refuses a server without S256', () => {
    expect(() => mcpAuthorizeUrl({ ...server, metadata: { ...server.metadata, code_challenge_methods_supported: ['plain'] } }, { clientId: 'c', redirectUri: 'https://app.example/cb', state: 's', codeChallenge: 'x' })).toThrow('S256');
  });

  it('reads back only a complete grant', () => {
    const grant = { baseUrl: 'https://knowledge.example/mcp', token: 't', accessToken: 't', refreshToken: 'r', expiresAt: '2099-01-01T00:00:00.000Z', clientId: 'c', resource: 'https://knowledge.example/mcp' };

    expect(asMcpGrant(grant)).toEqual(grant);
    expect(asMcpGrant({ ...grant, refreshToken: '' })).toBeNull();
  });
});
