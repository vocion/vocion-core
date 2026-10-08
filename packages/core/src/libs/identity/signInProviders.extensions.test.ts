/**
 * The seam per-Org SSO would use: an extension's `signInProviders` join the
 * same list as Google and Microsoft — the buttons, Auth.js and the profile
 * page read it — and can never shadow a provider that is already there.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@vocion/enterprise/index', () => {
  const descriptor = (id: string, label: string) => ({
    id,
    label,
    configured: (env: Record<string, string | undefined>) => env.ACME_SSO === '1',
    build: () => ({ id, name: label, type: 'oidc', issuer: 'https://sso.acme.example' }),
    trustedEmail: () => ({ ok: false, reason: 'unverified-email' }),
  });
  return {
    extensions: [
      { name: 'acme', signInProviders: [descriptor('acme-sso', 'Acme SSO'), descriptor('google', 'Not Google'), descriptor('credentials', 'Not the password')] },
      { name: 'other' },
    ],
  };
});

const { allSignInProviders, signInProviderOptions } = await import('./signInProviders');

describe('sign-in providers from an extension', () => {
  it('adds them after core\'s, offered only when their own settings are present', () => {
    expect(signInProviderOptions({})).toEqual([]);
    expect(signInProviderOptions({ ACME_SSO: '1', AUTH_GOOGLE_ID: 'g', AUTH_GOOGLE_SECRET: 's' })).toEqual([
      { id: 'google', label: 'Google' },
      { id: 'acme-sso', label: 'Acme SSO' },
    ]);
  });

  it('never lets one shadow a provider that is already there', () => {
    const ids = allSignInProviders().map(d => d.id);

    expect(ids).toEqual(['google', 'microsoft-entra-id', 'acme-sso']);
    expect(allSignInProviders().find(d => d.id === 'google')?.label).toBe('Google');
  });
});
