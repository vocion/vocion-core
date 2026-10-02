/**
 * The pull-read tool resolves its token the same way the connector does, so
 * a workspace that connected GitHub by installing the app can read a pull
 * request's head — without that, a verdict falls back to a sha the model
 * typed and the already-merged refusal never fires.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => [{ apiTokenId: null, config: { repos: ['northwind/orders-api'] } }],
      }),
    }),
  },
}));
vi.mock('@/models/Schema', () => ({
  knowledgeSourceSchema: { configJson: 'config_json', apiTokenId: 'api_token_id', orgId: 'org_id', slug: 'slug', enabled: 'enabled' },
}));
vi.mock('drizzle-orm', () => ({ and: () => undefined, eq: () => undefined }));
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForConnector: vi.fn(async () => ({ installationId: '777' })),
}));
vi.mock('@/libs/github/client', async importActual => ({
  ...(await importActual<typeof import('@/libs/github/client')>()),
  resolveGithubToken: vi.fn(async (c?: Record<string, unknown>) => (c?.installationId ? 'ghs_minted' : undefined)),
}));

describe('readPullHead with an installation credential', () => {
  it('mints the installation token instead of reading a pasted one', async () => {
    const { readPullHead } = await import('./githubPullRead');
    const { resolveGithubToken } = await import('@/libs/github/client');
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer ghs_minted');

      return new Response(JSON.stringify({ head: { sha: 'abc123' }, state: 'open', merged: false }));
    }));

    const head = await readPullHead('org_1', 'https://github.com/northwind/orders-api/pull/3');

    expect(resolveGithubToken).toHaveBeenCalledWith({ installationId: '777' });
    expect(head).toEqual({ sha: 'abc123', state: 'open', merged: false });

    vi.unstubAllGlobals();
  });
});
