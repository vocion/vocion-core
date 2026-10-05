import type { connectOptionFor } from '@/libs/connect/registry';
import type * as RealRegistry from '@/libs/connect/registry';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the page is told per connector. Wrong here means the form claims a
 * login nobody made (a pasted key read as "logged in"), or hides a failure.
 */

/**
 * Which login apps this test's server has: every provider is set up unless a
 * test takes it away, whatever the developer's .env holds, so the tests read
 * the same on a laptop and in CI.
 */
const providerSetup = vi.hoisted(() => ({ unconfigured: new Set<string>() }));

/**
 * The connect option as this test's server has it.
 * @param option - The real option.
 */
function setUpForTest(option: ReturnType<typeof connectOptionFor>): ReturnType<typeof connectOptionFor> {
  return option && { ...option, configured: !providerSetup.unconfigured.has(option.provider) };
}

vi.mock('@/libs/connect/registry', async (importOriginal) => {
  const real = await importOriginal<typeof RealRegistry>();
  return { ...real, connectOptionFor: (slug: string) => setUpForTest(real.connectOptionFor(slug)) };
});

vi.mock('@/libs/connect/attempts', () => ({ lastConnectAttempts: vi.fn() }));
vi.mock('./createSourceOnLogin', () => ({ newestLiveCredential: vi.fn() }));
vi.mock('@/services/SourceCredentialService', () => ({ connectorHoldingCredential: vi.fn(async () => null), getCredentialsForConnector: vi.fn(async () => null) }));

const { lastConnectAttempts } = await import('@/libs/connect/attempts');
const { newestLiveCredential } = await import('./createSourceOnLogin');
const { getCredentialsForConnector } = await import('@/services/SourceCredentialService');
const { connectInfoForOrg } = await import('./connectInfo');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lastConnectAttempts).mockResolvedValue(new Map());
  vi.mocked(newestLiveCredential).mockResolvedValue(null);
});

describe('connectInfoForOrg', () => {
  it('names the account of a live login', async () => {
    vi.mocked(newestLiveCredential).mockResolvedValue({ id: 'c1', obtainedVia: 'login', account: 'northwind', createdAt: new Date('2026-10-01T10:00:00.000Z'), keyHint: '…abcd' });
    const info = await connectInfoForOrg('org_a');

    expect(info.github).toMatchObject({ providerLabel: 'GitHub', loggedInAs: 'northwind' });
  });

  it('names no login provider when this server has no app for it, so the form offers paste alone', async () => {
    providerSetup.unconfigured.add('hubspot');
    try {
      const info = await connectInfoForOrg('org_a');

      expect(info.hubspot).toMatchObject({ providerLabel: null });
      expect(info.notion).toMatchObject({ providerLabel: 'Notion' });
    } finally {
      providerSetup.unconfigured.delete('hubspot');
    }
  });

  it('a Google login made for Drive reads as logged in on Drive, but not on Gmail or Google Ads, which get a fresh login or paste', async () => {
    vi.mocked(newestLiveCredential).mockResolvedValue({ id: 'g1', obtainedVia: 'login', account: 'ops@northwind.example', createdAt: new Date('2026-10-01T10:00:00.000Z'), keyHint: '…abcd' });
    vi.mocked(getCredentialsForConnector).mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresAt: '2099-01-01T00:00:00.000Z', scope: 'openid email https://www.googleapis.com/auth/drive.readonly' });
    const info = await connectInfoForOrg('org_a');

    expect(info.drive).toMatchObject({ loggedInAs: 'ops@northwind.example', stored: { kind: 'login' } });
    expect(info.gmail).toMatchObject({ loggedInAs: null, stored: null });
    expect(info['google-ads']).toBeUndefined();
  });

  it('does not call a pasted key a login', async () => {
    vi.mocked(newestLiveCredential).mockResolvedValue({ id: 'c1', obtainedVia: 'paste', account: null, createdAt: new Date('2026-10-01T10:00:00.000Z'), keyHint: '…abcd' });
    const info = await connectInfoForOrg('org_a');

    expect(info.github?.loggedInAs).toBeNull();
  });

  it('carries a failed newest attempt with an ISO time, and drops a successful one', async () => {
    vi.mocked(lastConnectAttempts).mockResolvedValue(new Map([
      ['slack', { connector: 'slack', provider: 'slack', ok: false, reason: 'access_denied', summary: 'Slack denied access', at: new Date('2026-10-01T16:12:00.000Z'), userId: 'u1' }],
      ['github', { connector: 'github', provider: 'github', ok: true, reason: null, summary: null, at: new Date('2026-10-01T16:12:00.000Z'), userId: 'u1' }],
    ]));
    const info = await connectInfoForOrg('org_a');

    expect(info.slack?.lastAttempt).toEqual({ at: '2026-10-01T16:12:00.000Z', summary: 'Slack denied access' });
    expect(info.github?.lastAttempt).toBeNull();
  });

  it('drops a failed attempt once a credential was saved after it, as a paste is', async () => {
    vi.mocked(lastConnectAttempts).mockResolvedValue(new Map([
      ['github', { connector: 'github', provider: 'github', ok: false, reason: 'access_denied', summary: 'GitHub denied access', at: new Date('2026-10-01T16:12:00.000Z'), userId: 'u1' }],
    ]));
    vi.mocked(newestLiveCredential).mockResolvedValue({ id: 'c1', obtainedVia: 'paste', account: null, createdAt: new Date('2026-10-01T16:30:00.000Z'), keyHint: '…abcd' });
    const pasted = await connectInfoForOrg('org_a');

    expect(pasted.github?.lastAttempt).toBeNull();

    vi.mocked(newestLiveCredential).mockResolvedValue({ id: 'c1', obtainedVia: 'paste', account: null, createdAt: new Date('2026-10-01T09:00:00.000Z'), keyHint: '…abcd' });
    const stale = await connectInfoForOrg('org_a');

    expect(stale.github?.lastAttempt).toEqual({ at: '2026-10-01T16:12:00.000Z', summary: 'GitHub denied access' });
  });
});
