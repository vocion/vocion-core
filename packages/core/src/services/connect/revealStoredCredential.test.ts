/**
 * Showing a stored login or key on the Connectors form (#1080), against PGlite.
 * The rules someone could get wrong: the value comes back keyed for the form's
 * inputs, every reveal leaves an audit row naming who and which credential (and
 * never the value), and a login with no token string reveals nothing.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { apiTokenSchema, projectSchema, sourceAuditSchema, sourceDekSchema, tenantAccountSchema } = await import('@/models/Schema');
const { sealLoginValues, storeLoginCredential, storePlatformKey } = await import('@/services/ApiTokenService');
const { revealStoredCredential, CREDENTIAL_REVEALED_EVENT } = await import('./revealStoredCredential');

const ORG = 'org_reveal_stored';
const ADMIN = 'user_reveal_admin';
const SECRET = 'pat-na1-reveal-me-0001';
const LOGIN_TOKEN = 'ghs_reveal_login_token_wxyz';

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-reveal-stored', name: 'Northwind', slug: 'northwind-reveal' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-reveal-stored', slug: 'northwind', name: 'Northwind' });
});

afterEach(async () => {
  await db.delete(sourceAuditSchema);
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
});

async function seedLogin(values: Record<string, unknown>) {
  const sealed = await sealLoginValues(ORG, values);
  return storeLoginCredential({ orgId: ORG, platform: 'github', name: 'github login', account: 'northwind', values, sealed, createdBy: ADMIN });
}

async function audits() {
  return db.select().from(sourceAuditSchema).where(eq(sourceAuditSchema.orgId, ORG));
}

describe('revealStoredCredential', () => {
  it('returns a pasted key by field name and writes one audit row without the value', async () => {
    const stored = await storePlatformKey({ orgId: ORG, platform: 'hubspot', name: 'HubSpot key', apiKey: SECRET, createdBy: ADMIN });
    const result = await revealStoredCredential({ orgId: ORG, userId: ADMIN, connector: 'hubspot' });
    const rows = await audits();

    expect(result).toEqual({ status: 'ok', values: { token: SECRET } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orgId: ORG, userId: ADMIN, event: CREDENTIAL_REVEALED_EVENT });
    expect(rows[0]!.metadata).toMatchObject({ connector: 'hubspot', credentialId: stored.id, obtainedVia: 'paste' });
    expect(JSON.stringify(rows[0])).not.toContain(SECRET);
  });

  it('returns the token of a login, under the platform\'s secret field, and audits it', async () => {
    const login = await seedLogin({ installationId: '42', token: LOGIN_TOKEN });
    const result = await revealStoredCredential({ orgId: ORG, userId: ADMIN, connector: 'github' });
    const rows = await audits();

    expect(result).toEqual({ status: 'ok', values: { token: LOGIN_TOKEN } });
    expect(rows[0]!.metadata).toMatchObject({ credentialId: login.id, obtainedVia: 'login' });
    expect(JSON.stringify(rows[0])).not.toContain(LOGIN_TOKEN);
  });

  it('a GitHub App installation holds no token string: nothing is shown and nothing is audited', async () => {
    await seedLogin({ installationId: '42', account: 'northwind' });
    const result = await revealStoredCredential({ orgId: ORG, userId: ADMIN, connector: 'github' });

    expect(result).toEqual({ status: 'no-token' });
    expect(await audits()).toHaveLength(0);
  });

  it('says there is nothing to show when the workspace holds no credential, and audits nothing', async () => {
    const result = await revealStoredCredential({ orgId: ORG, userId: ADMIN, connector: 'hubspot' });

    expect(result).toEqual({ status: 'none' });
    expect(await audits()).toHaveLength(0);
  });

  it('a reveal that cannot be audited fails and hands back no value', async () => {
    await storePlatformKey({ orgId: ORG, platform: 'hubspot', name: 'HubSpot key', apiKey: SECRET, createdBy: ADMIN });
    const insert = vi.spyOn(db, 'insert').mockImplementationOnce(() => {
      throw new Error('source_audit is unavailable');
    });

    try {
      await expect(revealStoredCredential({ orgId: ORG, userId: ADMIN, connector: 'hubspot' })).rejects.toThrow('source_audit is unavailable');
    } finally {
      insert.mockRestore();
    }

    expect(await audits()).toHaveLength(0);
  });

  it('never opens another workspace\'s key', async () => {
    await storePlatformKey({ orgId: ORG, platform: 'hubspot', name: 'HubSpot key', apiKey: SECRET, createdBy: ADMIN });
    const result = await revealStoredCredential({ orgId: 'org_somewhere_else', userId: ADMIN, connector: 'hubspot' });

    expect(result).toEqual({ status: 'none' });
  });
});
