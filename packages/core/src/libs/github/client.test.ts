/**
 * Which token a GitHub call goes out with: the pasted one as-is, or, for an
 * installation credential, one minted from the app.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveGithubToken, tokenFromCredentials } from './client';

vi.mock('./app', () => ({
  installationIdFrom: (c?: Record<string, unknown>) => (typeof c?.installationId === 'string' ? c.installationId : undefined),
  installationToken: vi.fn(async (id: string) => `ghs_for_${id}`),
}));

afterEach(() => vi.clearAllMocks());

describe('resolveGithubToken', () => {
  it('returns a pasted token untouched, under either field name', async () => {
    expect(await resolveGithubToken({ token: ' ghp_abc ' })).toBe('ghp_abc');
    expect(await resolveGithubToken({ accessToken: 'gho_x' })).toBe('gho_x');
    expect(tokenFromCredentials({ token: '' })).toBeUndefined();
  });

  it('mints from the installation when the bag holds one and no token', async () => {
    const { installationToken } = await import('./app');

    expect(await resolveGithubToken({ installationId: '777', account: 'acme' })).toBe('ghs_for_777');
    expect(installationToken).toHaveBeenCalledWith('777');
  });

  it('is undefined when the bag holds neither', async () => {
    expect(await resolveGithubToken({})).toBeUndefined();
    expect(await resolveGithubToken(undefined)).toBeUndefined();
  });
});
