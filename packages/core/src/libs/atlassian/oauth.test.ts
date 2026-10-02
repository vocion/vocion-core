/**
 * The pure parts of the Atlassian grant: which site a baseUrl names, and
 * whether a stored expiry has arrived.
 */

import { describe, expect, it } from 'vitest';
import { expiresAtFrom, isExpiring, siteForBaseUrl } from '@/libs/atlassian/oauth';

const ACME = { id: 'cloud-acme', url: 'https://acme.atlassian.net', name: 'Acme' };
const NORTHWIND = { id: 'cloud-nw', url: 'https://northwind.atlassian.net', name: 'Northwind' };

describe('siteForBaseUrl', () => {
  it('matches the site whose URL is the baseUrl', () => {
    expect(siteForBaseUrl({ sites: [ACME, NORTHWIND] }, 'https://northwind.atlassian.net')).toEqual(NORTHWIND);
  });

  it('ignores a trailing slash and host case', () => {
    expect(siteForBaseUrl({ sites: [ACME] }, 'https://ACME.atlassian.net/')).toEqual(ACME);
    expect(siteForBaseUrl({ sites: [{ ...ACME, url: 'https://acme.atlassian.net/' }] }, 'https://acme.atlassian.net')).toMatchObject({ id: 'cloud-acme' });
  });

  it('uses the pinned cloudId only to break a tie between sites with the same URL', () => {
    const twin = { id: 'cloud-twin', url: ACME.url, name: 'Acme twin' };

    expect(siteForBaseUrl({ sites: [ACME, twin], cloudId: 'cloud-twin' }, ACME.url)).toEqual(twin);
    expect(siteForBaseUrl({ sites: [ACME, twin] }, ACME.url)).toEqual(ACME);
  });

  it('returns null when nothing matches, even when a different site is pinned', () => {
    expect(siteForBaseUrl({ sites: [NORTHWIND], cloudId: 'cloud-nw' }, ACME.url)).toBeNull();
    expect(siteForBaseUrl({ sites: [] }, ACME.url)).toBeNull();
  });
});

describe('isExpiring', () => {
  const now = new Date('2026-09-30T12:00:00Z');

  it('is false while the stored expiry is ahead, true once it has arrived', () => {
    expect(isExpiring('2026-09-30T12:00:01Z', now)).toBe(false);
    expect(isExpiring('2026-09-30T12:00:00Z', now)).toBe(true);
    expect(isExpiring('2026-09-30T11:59:59Z', now)).toBe(true);
  });

  it('treats an unparseable expiry as expired', () => {
    expect(isExpiring('never', now)).toBe(true);
  });

  it('pairs with expiresAtFrom: an hour-long token expires five minutes early, and only then', () => {
    const at = expiresAtFrom(3600, now);

    expect(at).toBe('2026-09-30T12:55:00.000Z');
    expect(isExpiring(at, new Date('2026-09-30T12:54:59Z'))).toBe(false);
    expect(isExpiring(at, new Date('2026-09-30T12:55:00Z'))).toBe(true);
  });
});
