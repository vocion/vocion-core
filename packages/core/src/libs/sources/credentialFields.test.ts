/**
 * Guards the CRED_FIELDS half of vocion-core#52: every connector that
 * needs credentials must have an entry keyed by its real registry slug.
 * A missing/mismatched key (the original `googleAds` vs `google-ads` bug)
 * silently falls back to a generic single "Token" field that doesn't match
 * what the connector actually reads from `ctx.credentials`.
 */

import { describe, expect, it } from 'vitest';
import { CRED_FIELDS } from '@/libs/sources/credentialFields';
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
