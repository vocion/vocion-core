import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the page is told per connector. Wrong here means the form claims a
 * login nobody made (a pasted key read as "logged in"), or hides a failure.
 */

vi.mock('@/libs/connect/attempts', () => ({ lastConnectAttempts: vi.fn() }));
vi.mock('./createSourceOnLogin', () => ({ newestLiveCredential: vi.fn() }));

const { lastConnectAttempts } = await import('@/libs/connect/attempts');
const { newestLiveCredential } = await import('./createSourceOnLogin');
const { connectInfoForOrg } = await import('./connectInfo');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lastConnectAttempts).mockResolvedValue(new Map());
  vi.mocked(newestLiveCredential).mockResolvedValue(null);
});

describe('connectInfoForOrg', () => {
  it('names the account of a live login', async () => {
    vi.mocked(newestLiveCredential).mockResolvedValue({ id: 'c1', obtainedVia: 'login', account: 'northwind', createdAt: new Date('2026-10-01T10:00:00.000Z') });
    const info = await connectInfoForOrg('org_a');

    expect(info.github).toMatchObject({ providerLabel: 'GitHub', loggedInAs: 'northwind' });
  });

  it('does not call a pasted key a login', async () => {
    vi.mocked(newestLiveCredential).mockResolvedValue({ id: 'c1', obtainedVia: 'paste', account: null, createdAt: new Date('2026-10-01T10:00:00.000Z') });
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
    vi.mocked(newestLiveCredential).mockResolvedValue({ id: 'c1', obtainedVia: 'paste', account: null, createdAt: new Date('2026-10-01T16:30:00.000Z') });
    const pasted = await connectInfoForOrg('org_a');

    expect(pasted.github?.lastAttempt).toBeNull();

    vi.mocked(newestLiveCredential).mockResolvedValue({ id: 'c1', obtainedVia: 'paste', account: null, createdAt: new Date('2026-10-01T09:00:00.000Z') });
    const stale = await connectInfoForOrg('org_a');

    expect(stale.github?.lastAttempt).toEqual({ at: '2026-10-01T16:12:00.000Z', summary: 'GitHub denied access' });
  });
});
