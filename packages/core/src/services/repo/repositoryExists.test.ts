/**
 * A repo record is never proposed for a repository GitHub does not have
 * (2026-10-01: a pending record for a 404 was built from three times). Every
 * owner and name below is invented.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const tokenForRepo = vi.fn(async (_org: string, _name: string): Promise<string | null> => null);
vi.mock('@/services/agents/tools/githubPullRead', () => ({ tokenForRepo }));

const { githubFullName, missingRepositoryRefusal, repositoryExists } = await import('./repositoryExists');

const schema = { properties: { url: { 'type': 'string', 'x-verify': 'repository' }, slug: { type: 'string' } } };

function answer(status: number) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status }));
}

afterEach(() => {
  vi.restoreAllMocks();
  tokenForRepo.mockReset();
  tokenForRepo.mockResolvedValue(null);
});

describe('which repository a record names', () => {
  it('reads owner/name from a GitHub URL or owner/name, and nothing from prose', () => {
    expect(githubFullName('https://github.com/Acme/northwind-core')).toBe('Acme/northwind-core');
    expect(githubFullName('https://github.com/Acme/northwind-core.git')).toBe('Acme/northwind-core');
    expect(githubFullName('Acme/northwind-core')).toBe('Acme/northwind-core');
    expect(githubFullName('Northwind (portal) monorepo')).toBeNull();
  });
});

describe('whether it exists', () => {
  it('a 404 is a repository that is not there, said with whose token read it', async () => {
    tokenForRepo.mockResolvedValue('tok');
    const fetch = answer(404);

    expect(await repositoryExists('org', 'https://github.com/northwind-example/portal')).toMatchObject({ exists: false, fullName: 'northwind-example/portal' });
    expect(fetch.mock.calls[0]![0]).toBe('https://api.github.com/repos/northwind-example/portal');
    expect((fetch.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer tok' });
  });

  it('a 200 exists; a rate limit, an outage or another host is "could not tell"', async () => {
    answer(200);

    expect(await repositoryExists('org', 'Acme/northwind-core')).toEqual({ exists: true, fullName: 'Acme/northwind-core' });

    vi.restoreAllMocks();
    answer(403);

    expect((await repositoryExists('org', 'Acme/northwind-core')).exists).toBeNull();
    expect((await repositoryExists('org', 'https://git.example.test/acme/core')).exists).toBeNull();
  });
});

describe('the proposal door', () => {
  it('refuses a repository GitHub does not have, with the reason', async () => {
    answer(404);

    expect(await missingRepositoryRefusal('org', schema, { url: 'https://github.com/northwind-example/portal' }, 'Northwind (portal) monorepo')).toMatch(/^Not proposed: GitHub has no repository northwind-example\/portal/);
  });

  it('refuses a record that names no repository, and reads a title that is owner/name', async () => {
    const fetch = answer(200);

    expect(await missingRepositoryRefusal('org', schema, {}, 'Northwind (portal) monorepo')).toMatch(/names no repository/);
    expect(await missingRepositoryRefusal('org', schema, {}, 'Acme/northwind-core')).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('passes a repository that exists, and does not read a type that marks no field', async () => {
    const fetch = answer(200);

    expect(await missingRepositoryRefusal('org', schema, { url: 'https://github.com/Acme/northwind-core' }, 'x')).toBeUndefined();
    expect(await missingRepositoryRefusal('org', { properties: { url: { type: 'string' } } }, {}, 'x')).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never refuses when GitHub could not be read', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    expect(await missingRepositoryRefusal('org', schema, { url: 'https://github.com/Acme/northwind-core' }, 'x')).toBeUndefined();
  });
});
