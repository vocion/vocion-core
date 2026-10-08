/**
 * Where a family source's credential comes from: the row it names, else the
 * login on its install, else the workspace's one live key on the platform —
 * and always the asking org's own.
 */
import { describe, expect, it, vi } from 'vitest';

const vault = vi.hoisted(() => ({
  byToken: new Map<string, Record<string, unknown>>(),
  byInstall: new Map<string, Record<string, unknown>>(),
  byPlatform: new Map<string, Record<string, unknown>>(),
  calls: [] as Array<{ orgId: string; connectorSlug: string; apiTokenId: string | null }>,
}));

vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForConnector: async (input: { orgId: string; connectorSlug: string; apiTokenId: string | null }) => {
    vault.calls.push(input);
    if (input.apiTokenId) {
      const row = vault.byToken.get(`${input.orgId}:${input.apiTokenId}`);
      if (!row) {
        throw new Error('The Snowflake credential this connector uses was revoked.');
      }
      return row;
    }
    return vault.byInstall.get(`${input.orgId}:${input.connectorSlug}`);
  },
}));
vi.mock('@/services/ApiTokenService', () => ({
  resolvePlatformCredential: async (orgId: string, platform: string) => vault.byPlatform.get(`${orgId}:${platform}`) ?? null,
}));

const { familySourceCredentials, noCredentialMessage } = await import('./familyCredentials');

const source = (over: Partial<{ slug: string; kind: string; apiTokenId: string | null }> = {}) => ({ id: 1, slug: 'snowflake', kind: 'snowflake', config: {}, apiTokenId: null, ...over });

describe('familySourceCredentials', () => {
  it('reads the credential the source row names, labelled by its connector kind', async () => {
    vault.byToken.set('org_a:tok_1', { account: 'northwind-analytics', user: 'VOCION_READER' });

    await expect(familySourceCredentials('org_a', source({ slug: 'snowflake-marts', apiTokenId: 'tok_1' }))).resolves.toEqual({ account: 'northwind-analytics', user: 'VOCION_READER' });
    expect(vault.calls.at(-1)).toEqual({ orgId: 'org_a', connectorSlug: 'snowflake', apiTokenId: 'tok_1' });
  });

  it('says so when the named credential is revoked, rather than falling through to another key', async () => {
    vault.byPlatform.set('org_a:snowflake', { account: 'another' });

    await expect(familySourceCredentials('org_a', source({ apiTokenId: 'tok_gone' }))).rejects.toThrow(/revoked/);
  });

  it('falls back to the login on the install, by source slug then by kind', async () => {
    vault.byInstall.set('org_a:linkedin-ads', { accessToken: 'login-token' });

    await expect(familySourceCredentials('org_a', source({ slug: 'linkedin-brand', kind: 'linkedin-ads' }))).resolves.toEqual({ accessToken: 'login-token' });
  });

  it('falls back last to the workspace\'s one live key on the platform, and to null when there is none', async () => {
    vault.byPlatform.set('org_b:meta-ads', { token: 'org-b-token' });

    await expect(familySourceCredentials('org_b', source({ slug: 'meta-ads', kind: 'meta-ads' }))).resolves.toEqual({ token: 'org-b-token' });
    await expect(familySourceCredentials('org_c', source({ slug: 'meta-ads', kind: 'meta-ads' }))).resolves.toBeNull();
  });

  it('never answers one org with another org\'s key', async () => {
    vault.byPlatform.set('org_a:mixpanel', { username: 'org-a-reader', secret: 'a-secret-0001' });
    vault.byPlatform.set('org_b:mixpanel', { username: 'org-b-reader', secret: 'b-secret-0001' });
    const mixpanel = source({ slug: 'mixpanel', kind: 'mixpanel' });

    await expect(familySourceCredentials('org_a', mixpanel)).resolves.toMatchObject({ username: 'org-a-reader' });
    await expect(familySourceCredentials('org_b', mixpanel)).resolves.toMatchObject({ username: 'org-b-reader' });
  });

  it('names where to connect when nothing is stored', () => {
    expect(noCredentialMessage({ slug: 'bigquery' }, 'BigQuery')).toMatch(/The bigquery source has no BigQuery credential stored.*\/dashboard\/connectors/);
  });
});
