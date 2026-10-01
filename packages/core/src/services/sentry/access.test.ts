import { beforeEach, describe, expect, it, vi } from 'vitest';

const bySource = vi.fn();
const byPlatform = vi.fn();
vi.mock('@/services/SourceCredentialService', () => ({ getCredentialsForSource: (...a: unknown[]) => bySource(...a) }));
vi.mock('@/services/ApiTokenService', () => ({ resolvePlatformCredential: (...a: unknown[]) => byPlatform(...a) }));

const { sentryFor } = await import('./access');

beforeEach(() => {
  bySource.mockReset();
  byPlatform.mockReset();
});

describe('the workspace\'s Sentry credential', () => {
  it('is the connected source\'s, then the platform credential\'s', async () => {
    bySource.mockResolvedValue({ token: 'sntrys_a', org: 'northwind', host: 'https://de.sentry.io' });

    expect(await sentryFor('org_1')).toEqual({ ok: true, credentials: { token: 'sntrys_a', org: 'northwind', host: 'https://de.sentry.io' } });
    expect(byPlatform).not.toHaveBeenCalled();

    bySource.mockResolvedValue(undefined);
    byPlatform.mockResolvedValue({ token: 'sntrys_b', org: 'northwind' });

    expect(await sentryFor('org_1')).toMatchObject({ ok: true, credentials: { token: 'sntrys_b', host: 'https://us.sentry.io' } });
  });

  it('says why when there is none, including a revoked source credential', async () => {
    bySource.mockRejectedValue(new Error('The Sentry credential this source used was revoked.'));
    byPlatform.mockResolvedValue(null);
    const r = await sentryFor('org_1');

    expect(r.ok).toBe(false);
    expect((r as { message: string }).message).toMatch(/revoked.*Connect Sentry/);
  });
});
