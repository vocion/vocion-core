/**
 * Completeness guards for UI_FIELDS — the single per-connector source of
 * truth for both the Add-Source dialog's configFields and the
 * Connect-credential dialog's credential fields. `configFields.test.ts`
 * separately guards that configFields round-trips through the real
 * configSchema; this file guards that every connector actually has an
 * entry here at all, keyed correctly.
 */

import { describe, expect, it } from 'vitest';
import { listConnectors } from '@/libs/sources/registry';
import { UI_FIELDS, validateCredentialSubmission } from '@/libs/sources/uiFields';

describe('UI_FIELDS', () => {
  it('every registered connector has an entry, keyed by its real slug', () => {
    for (const connector of listConnectors()) {
      expect(UI_FIELDS[connector.slug], `UI_FIELDS is missing an entry for slug "${connector.slug}"`).toBeDefined();
    }
  });

  it('every connector needing credentials has a credentials spec with at least one field', () => {
    const needsCreds = listConnectors().filter(c => c.authKind !== 'none');
    for (const connector of needsCreds) {
      const spec = UI_FIELDS[connector.slug]?.credentials;

      expect(spec, `UI_FIELDS["${connector.slug}"].credentials is missing`).toBeDefined();
      expect(spec!.fields.length).toBeGreaterThan(0);
    }
  });

  it('no stale/mistyped top-level key — every key is a real registered connector slug', () => {
    const validSlugs = new Set(listConnectors().map(c => c.slug));
    for (const key of Object.keys(UI_FIELDS)) {
      expect(validSlugs.has(key), `UI_FIELDS key "${key}" does not match any registered connector slug`).toBe(true);
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
