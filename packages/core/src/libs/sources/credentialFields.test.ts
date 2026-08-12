/**
 * Guards the CRED_FIELDS half of vocion-core#52: every connector that
 * needs credentials must have an entry keyed by its real registry slug.
 * A missing/mismatched key (the original `googleAds` vs `google-ads` bug)
 * silently falls back to a generic single "Token" field that doesn't match
 * what the connector actually reads from `ctx.credentials`.
 */

import { describe, expect, it } from 'vitest';
import { CRED_FIELDS, validateCredentialSubmission } from '@/libs/sources/credentialFields';
import { listConnectors } from '@/libs/sources/registry';

describe('CRED_FIELDS', () => {
  const needsCreds = listConnectors().filter(c => c.authKind !== 'none');

  for (const connector of needsCreds) {
    it(`${connector.slug}: has a credential field spec keyed by its real slug`, () => {
      const spec = CRED_FIELDS[connector.slug];

      expect(spec, `CRED_FIELDS is missing an entry for slug "${connector.slug}"`).toBeDefined();
      expect(spec!.fields.length).toBeGreaterThan(0);
    });
  }

  it('every key is a real registered connector slug (no stale/mistyped entries)', () => {
    const validSlugs = new Set(listConnectors().map(c => c.slug));
    for (const key of Object.keys(CRED_FIELDS)) {
      expect(validSlugs.has(key), `CRED_FIELDS key "${key}" does not match any registered connector slug`).toBe(true);
    }
  });
});

describe('validateCredentialSubmission', () => {
  // Guards the exact bug found reviewing this PR: the credentials route
  // hardcoded a "token is required" check, which rejects any connector
  // whose real credential shape has no `token` key at all.
  it('accepts zoom given its real accountId/clientId/clientSecret keys, no token', () => {
    const { trimmed, missingKey } = validateCredentialSubmission('zoom', {
      accountId: 'acc1',
      clientId: 'cid1',
      clientSecret: 'secret1',
    });

    expect(missingKey).toBeNull();
    expect(trimmed).toEqual({ accountId: 'acc1', clientId: 'cid1', clientSecret: 'secret1' });
  });

  it('rejects zoom missing one of its required keys, naming which one', () => {
    const { missingKey } = validateCredentialSubmission('zoom', { accountId: 'acc1', clientId: 'cid1' });

    expect(missingKey).toBe('clientSecret');
  });

  it('accepts jira given its real email/apiToken keys, no token', () => {
    const { trimmed, missingKey } = validateCredentialSubmission('jira', {
      email: 'admin@acme.com',
      apiToken: 'tok1',
    });

    expect(missingKey).toBeNull();
    expect(trimmed).toEqual({ email: 'admin@acme.com', apiToken: 'tok1' });
  });

  it('trims whitespace and treats a whitespace-only value as missing', () => {
    const { trimmed, missingKey } = validateCredentialSubmission('hubspot', { token: '  abc123  ' });

    expect(trimmed).toEqual({ token: 'abc123' });
    expect(missingKey).toBeNull();

    const blank = validateCredentialSubmission('hubspot', { token: '   ' });

    expect(blank.missingKey).toBe('token');
  });

  it('falls back to requiring a single "token" key for an unregistered connector slug', () => {
    const { missingKey } = validateCredentialSubmission('made-up-connector', {});

    expect(missingKey).toBe('token');
  });
});
