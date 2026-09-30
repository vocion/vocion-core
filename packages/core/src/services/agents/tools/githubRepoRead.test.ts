import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./githubPullRead', () => ({ tokenForRepo: vi.fn(async (_org: string, repo: string) => (repo === 'acme/northwind-core' ? 'tok-test' : null)) }));

const { parseRepoUrl, readConnectedRepo } = await import('./githubRepoRead');

describe('parseRepoUrl', () => {
  it('reads a repository root, a folder and a file, and leaves pull requests and issues alone', () => {
    expect(parseRepoUrl('https://github.com/acme/northwind-core')).toEqual({ owner: 'acme', repo: 'northwind-core', kind: 'root', ref: null, path: '' });
    expect(parseRepoUrl('https://github.com/acme/northwind-core/tree/main/apps/web')).toMatchObject({ kind: 'tree', ref: 'main', path: 'apps/web' });
    expect(parseRepoUrl('https://github.com/acme/northwind-core/blob/main/apps/web/src/Page.tsx')).toMatchObject({ kind: 'blob', path: 'apps/web/src/Page.tsx' });
    expect(parseRepoUrl('https://github.com/acme/northwind-core/pull/35')).toBeNull();
    expect(parseRepoUrl('https://github.com/acme/northwind-core/issues/3')).toBeNull();
  });
});

describe('readConnectedRepo', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('answers a private repository\'s root with its listing and README, read with the workspace\'s token (conversation 397)', async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, auth: init.headers.authorization ?? null });
      if (url.endsWith('/contents/')) {
        return new Response(JSON.stringify([{ name: 'apps', type: 'dir', path: 'apps' }, { name: 'README.md', type: 'file', path: 'README.md', size: 12 }]));
      }
      return new Response('# Northwind');
    }));

    const text = await readConnectedRepo('org-1', 'https://github.com/acme/northwind-core');

    expect(text).toContain('- apps/');
    expect(text).toContain('# Northwind');
    expect(calls.every(c => c.auth === 'Bearer tok-test')).toBe(true);
  });

  it('reads a file\'s text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('export const Page = () => null;')));

    const text = await readConnectedRepo('org-1', 'https://github.com/acme/northwind-core/blob/main/apps/web/Page.tsx');

    expect(text).toContain('export const Page');
  });

  it('leaves a repository the workspace holds no token for to the ordinary fetch', async () => {
    expect(await readConnectedRepo('org-1', 'https://github.com/someone/else')).toBeNull();
  });
});
