/**
 * What Google and Microsoft are trusted to vouch for. The address that comes
 * out of these functions is matched against logins and invites, so anything
 * a stranger could set on their own profile must come out as a refusal.
 */
import { describe, expect, it } from 'vitest';
import { entraIssuerMatchesTenant, entraTrustedEmail, googleTrustedEmail, MICROSOFT_PERSONAL_ACCOUNTS_TENANT, normalizedEmail } from './trustedEmail';

const NORTHWIND_TENANT = '3f2a8c1e-5b7d-4e9a-8c6f-1d2e3f4a5b6c';
const ISSUER = `https://login.microsoftonline.com/${NORTHWIND_TENANT}/v2.0`;

describe('googleTrustedEmail', () => {
  it('takes the address when Google verified it, lowercased', () => {
    expect(googleTrustedEmail({ email: 'Dana@Northwind.example', email_verified: true })).toEqual({ ok: true, email: 'dana@northwind.example' });
  });

  it('refuses an unverified, missing or loosely-verified address', () => {
    expect(googleTrustedEmail({ email: 'dana@northwind.example', email_verified: false })).toEqual({ ok: false, reason: 'unverified-email' });
    expect(googleTrustedEmail({ email: 'dana@northwind.example' })).toEqual({ ok: false, reason: 'unverified-email' });
    expect(googleTrustedEmail({ email: 'dana@northwind.example', email_verified: 'true' })).toEqual({ ok: false, reason: 'unverified-email' });
    expect(googleTrustedEmail({ email_verified: true })).toEqual({ ok: false, reason: 'unverified-email' });
    expect(googleTrustedEmail(null)).toEqual({ ok: false, reason: 'unverified-email' });
  });
});

describe('entraIssuerMatchesTenant', () => {
  it('accepts the tenant-specific v2.0 issuer for the token\'s own tid', () => {
    expect(entraIssuerMatchesTenant({ tid: NORTHWIND_TENANT, iss: ISSUER })).toBe(true);
  });

  it('refuses an issuer for another tenant, the multi-tenant placeholder, or a v1 issuer', () => {
    const otherTenant = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

    expect(entraIssuerMatchesTenant({ tid: NORTHWIND_TENANT, iss: `https://login.microsoftonline.com/${otherTenant}/v2.0` })).toBe(false);
    expect(entraIssuerMatchesTenant({ tid: NORTHWIND_TENANT, iss: 'https://login.microsoftonline.com/organizations/v2.0' })).toBe(false);
    expect(entraIssuerMatchesTenant({ tid: NORTHWIND_TENANT, iss: `https://sts.windows.net/${NORTHWIND_TENANT}/` })).toBe(false);
    expect(entraIssuerMatchesTenant({ tid: 'organizations', iss: 'https://login.microsoftonline.com/organizations/v2.0' })).toBe(false);
    expect(entraIssuerMatchesTenant({ iss: ISSUER })).toBe(false);
  });
});

describe('entraTrustedEmail', () => {
  const base = { tid: NORTHWIND_TENANT, iss: ISSUER };

  it('takes the sign-in name, whose domain the tenant must have verified', () => {
    expect(entraTrustedEmail({ ...base, preferred_username: 'Dana@Northwind.example' })).toEqual({ ok: true, email: 'dana@northwind.example' });
  });

  it('ignores an `email` claim Entra does not vouch for — the nOAuth pattern', () => {
    // A tenant admin set Dana's address on someone else's `mail` attribute.
    const claims = { ...base, email: 'dana@kestrel.example', preferred_username: 'mallory@northwind.example' };

    expect(entraTrustedEmail(claims)).toEqual({ ok: true, email: 'mallory@northwind.example' });
    expect(entraTrustedEmail({ ...claims, xms_edov: false })).toEqual({ ok: true, email: 'mallory@northwind.example' });
  });

  it('takes `email` when Entra says its domain owner is verified (`xms_edov`)', () => {
    expect(entraTrustedEmail({ ...base, email: 'dana@northwind.example', xms_edov: true, preferred_username: 'dana@corp.northwind.example' }))
      .toEqual({ ok: true, email: 'dana@northwind.example' });
  });

  it('refuses a sign-in name that is not an address', () => {
    expect(entraTrustedEmail({ ...base, preferred_username: 'dana' })).toEqual({ ok: false, reason: 'unverified-email' });
    expect(entraTrustedEmail({ ...base, email: 'dana@northwind.example' })).toEqual({ ok: false, reason: 'unverified-email' });
  });

  it('refuses a token whose issuer is not its tenant', () => {
    expect(entraTrustedEmail({ tid: NORTHWIND_TENANT, iss: 'https://login.microsoftonline.com/common/v2.0', preferred_username: 'dana@northwind.example' }))
      .toEqual({ ok: false, reason: 'untrusted-issuer' });
  });

  it('refuses a personal Microsoft account', () => {
    const tid = MICROSOFT_PERSONAL_ACCOUNTS_TENANT;

    expect(entraTrustedEmail({ tid, iss: `https://login.microsoftonline.com/${tid}/v2.0`, preferred_username: 'dana@outlook.example' }))
      .toEqual({ ok: false, reason: 'personal-account' });
  });
});

describe('normalizedEmail', () => {
  it('lowercases and trims an address, and rejects what is not one', () => {
    expect(normalizedEmail('  Dana@Northwind.example ')).toBe('dana@northwind.example');
    expect(normalizedEmail('dana')).toBeNull();
    expect(normalizedEmail('dana@localhost')).toBeNull();
    expect(normalizedEmail('a@b@northwind.example')).toBeNull();
    expect(normalizedEmail('dana smith@northwind.example')).toBeNull();
    expect(normalizedEmail(42)).toBeNull();
  });
});
