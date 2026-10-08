/**
 * A provider is offered only when its settings are present, and the list
 * the buttons, Auth.js and the profile page read is one list.
 */
import { describe, expect, it } from 'vitest';
import { allSignInProviders, configuredSignInProvider, configuredSignInProviders, MICROSOFT_ORGANIZATIONS_ISSUER, registerSignInProvider, signInProviderOptions } from './signInProviders';

const GOOGLE = { AUTH_GOOGLE_ID: 'northwind-google-client', AUTH_GOOGLE_SECRET: 'northwind-google-secret' };
const MICROSOFT = { AUTH_MICROSOFT_ENTRA_ID_ID: 'northwind-entra-client', AUTH_MICROSOFT_ENTRA_ID_SECRET: 'northwind-entra-secret' };

describe('provider gating by env', () => {
  it('offers nothing when nothing is set', () => {
    expect(configuredSignInProviders({})).toEqual([]);
    expect(signInProviderOptions({})).toEqual([]);
  });

  it('offers each provider only when both of its values are set', () => {
    expect(signInProviderOptions(GOOGLE)).toEqual([{ id: 'google', label: 'Google' }]);
    expect(signInProviderOptions(MICROSOFT)).toEqual([{ id: 'microsoft-entra-id', label: 'Microsoft' }]);
    expect(signInProviderOptions({ ...GOOGLE, ...MICROSOFT })).toEqual([
      { id: 'google', label: 'Google' },
      { id: 'microsoft-entra-id', label: 'Microsoft' },
    ]);
  });

  it('treats half a client, or a blank value, as not set', () => {
    expect(signInProviderOptions({ AUTH_GOOGLE_ID: 'northwind-google-client' })).toEqual([]);
    expect(signInProviderOptions({ AUTH_MICROSOFT_ENTRA_ID_SECRET: 'northwind-entra-secret' })).toEqual([]);
    expect(signInProviderOptions({ AUTH_GOOGLE_ID: '  ', AUTH_GOOGLE_SECRET: 'northwind-google-secret' })).toEqual([]);
  });

  it('finds a provider by id only when it is offered', () => {
    expect(configuredSignInProvider('google', GOOGLE)?.label).toBe('Google');
    expect(configuredSignInProvider('microsoft-entra-id', GOOGLE)).toBeNull();
  });
});

describe('the Auth.js providers built from it', () => {
  it('registers Microsoft against the multi-tenant work-and-school endpoint, without the Graph photo scope', () => {
    const provider = configuredSignInProvider('microsoft-entra-id', MICROSOFT)!.build(MICROSOFT) as unknown as {
      id: string;
      options: { issuer: string; clientId: string; allowDangerousEmailAccountLinking: boolean; checks: string[]; authorization: { params: { scope: string } } };
    };

    expect(provider.id).toBe('microsoft-entra-id');
    expect(provider.options.issuer).toBe(MICROSOFT_ORGANIZATIONS_ISSUER);
    expect(provider.options.clientId).toBe('northwind-entra-client');
    expect(provider.options.checks).toEqual(['pkce', 'state']);
    expect(provider.options.authorization.params.scope).toBe('openid profile email');
  });

  it('gives Auth.js only a verified address to link by', async () => {
    const provider = configuredSignInProvider('google', GOOGLE)!.build(GOOGLE) as unknown as {
      options: { profile: (claims: Record<string, unknown>) => Promise<{ email: string | null }> | { email: string | null } };
    };

    await expect(Promise.resolve(provider.options.profile({ sub: 'g-1', email: 'Dana@Northwind.example', email_verified: true })))
      .resolves
      .toMatchObject({ email: 'dana@northwind.example' });
    await expect(Promise.resolve(provider.options.profile({ sub: 'g-2', email: 'dana@northwind.example', email_verified: false })))
      .resolves
      .toMatchObject({ email: null });
  });
});

describe('registerSignInProvider — the extension seam', () => {
  it('adds a provider to the same list, and refuses a taken id', () => {
    registerSignInProvider({
      id: 'acme-sso',
      label: 'Acme SSO',
      configured: env => env.ACME_SSO === '1',
      build: () => ({ id: 'acme-sso', name: 'Acme SSO', type: 'oidc', issuer: 'https://sso.acme.example' }),
      trustedEmail: () => ({ ok: false, reason: 'unverified-email' }),
    });

    expect(allSignInProviders().map(d => d.id)).toContain('acme-sso');
    expect(signInProviderOptions({ ACME_SSO: '1' })).toEqual([{ id: 'acme-sso', label: 'Acme SSO' }]);
    expect(() => registerSignInProvider({ ...allSignInProviders()[0]! })).toThrow(/already exists/);
    expect(() => registerSignInProvider({ ...allSignInProviders()[0]!, id: 'credentials' })).toThrow(/already exists/);
  });
});
