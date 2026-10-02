/**
 * The page payload for a stored login or key (#1080), against PGlite. This is
 * what reaches the browser on page load, so the rule is: account and masked
 * tail, never the value.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { apiTokenSchema, knowledgeSourceSchema, projectSchema, sourceDekSchema, tenantAccountSchema } = await import('@/models/Schema');
const { sealLoginValues, storeLoginCredential, storePlatformKey } = await import('@/services/ApiTokenService');
const { connectInfoForOrg } = await import('./connectInfo');

const ORG = 'org_info_stored';
const LOGIN_TOKEN = 'ghs_payload_login_token_abcd';
const PASTED = 'pat-na1-payload-paste-wxyz';

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-info-stored', name: 'Northwind', slug: 'northwind-info' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-info-stored', slug: 'northwind', name: 'Northwind' });
});

afterEach(async () => {
  await db.delete(knowledgeSourceSchema);
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
});

async function seedLogin(values: Record<string, unknown>) {
  const sealed = await sealLoginValues(ORG, values);
  return storeLoginCredential({ orgId: ORG, platform: 'github', name: 'github login', account: 'northwind', values, sealed, createdBy: 'u1' });
}

describe('connectInfoForOrg stored credential', () => {
  it('carries the account and masked tail of a login, and no raw token anywhere in the payload', async () => {
    await seedLogin({ installationId: '42', token: LOGIN_TOKEN });
    const info = await connectInfoForOrg(ORG);

    expect(info.github?.stored).toEqual({ kind: 'login', account: 'northwind', hint: '…abcd', revealable: true });
    expect(JSON.stringify(info)).not.toContain(LOGIN_TOKEN);
  });

  it('a pasted key shows only its tail, on a connector that has no login at all', async () => {
    await storePlatformKey({ orgId: ORG, platform: 'hubspot', name: 'HubSpot key', apiKey: PASTED, createdBy: 'u1' });
    const info = await connectInfoForOrg(ORG);

    expect(info.hubspot?.stored).toEqual({ kind: 'paste', account: null, hint: '…wxyz', revealable: true });
    expect(JSON.stringify(info)).not.toContain(PASTED);
  });

  it('a login with no token string is marked as having nothing to show', async () => {
    await seedLogin({ installationId: '42' });
    const info = await connectInfoForOrg(ORG);

    expect(info.github?.stored).toMatchObject({ kind: 'login', hint: 'login', revealable: false });
  });

  it('leaves out a pasted key that another source already holds, since keeping it would be refused', async () => {
    const key = await storePlatformKey({ orgId: ORG, platform: 'hubspot', name: 'HubSpot key', apiKey: PASTED, createdBy: 'u1' });
    await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'hubspot', kind: 'plugin', configJson: { _connector: 'hubspot' }, apiTokenId: key.id, apiTokenExclusive: true });
    const info = await connectInfoForOrg(ORG);

    expect(info.hubspot?.stored ?? null).toBeNull();
  });
});
