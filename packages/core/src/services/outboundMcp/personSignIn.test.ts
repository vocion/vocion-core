/**
 * Per-person MCP sign-in, against PGlite: a grant is kept in its person's
 * Personal, read only for that person, refreshed once when it runs out, and
 * never stands in for anyone else.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const refresh = vi.hoisted(() => ({ calls: 0, fail: false }));
vi.mock('@/libs/outboundMcp/oauth', async importOriginal => ({
  ...await importOriginal<typeof import('@/libs/outboundMcp/oauth')>(),
  refreshMcpGrant: async (grant: Record<string, string>) => {
    refresh.calls++;
    if (refresh.fail) {
      throw new Error('invalid_grant');
    }
    return { ...grant, token: 'at-new', accessToken: 'at-new', refreshToken: 'rt-new', expiresAt: '2099-01-01T00:00:00.000Z' };
  },
}));

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, apiTokenSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { ensurePersonalProject } = await import('@/services/workspace/personalProject');
const { personMcpCredentials, storePersonGrant } = await import('./personSignIn');

const ACCOUNT = 'acct-mcp-northwind';
const ALEX = 'usr-mcp-alex';
const CASS = 'usr-mcp-cass';
const URL = 'https://knowledge.northwind.example/mcp';
const SOURCE = { orgId: 'proj-mcp-finance', slug: 'company-knowledge', name: 'Company Knowledge', url: URL };

function grant(expiresAt = '2099-01-01T00:00:00.000Z') {
  return { baseUrl: URL, token: 'at-alex', accessToken: 'at-alex', refreshToken: 'rt-alex', expiresAt, clientId: 'client-1', resource: URL };
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Northwind', slug: 'northwind-mcp' });
  await db.insert(userSchema).values([
    { id: ALEX, email: 'alex@northwind.example', name: 'Alex Rivera' },
    { id: CASS, email: 'cass@northwind.example', name: 'Cass Lund' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: ACCOUNT, userId: ALEX, role: 'admin' },
    { accountId: ACCOUNT, userId: CASS, role: 'member' },
  ]);
  await db.insert(projectSchema).values({ id: SOURCE.orgId, accountId: ACCOUNT, slug: 'finance-mcp', name: 'Finance' });
  await ensurePersonalProject(ALEX, ACCOUNT);
  await ensurePersonalProject(CASS, ACCOUNT);
});

afterEach(async () => {
  await db.delete(apiTokenSchema);
  Object.assign(refresh, { calls: 0, fail: false });
});

describe('per-person MCP credentials', () => {
  it('reads the signed-in person\'s own grant, and only theirs', async () => {
    await storePersonGrant({ userId: ALEX, sourceName: SOURCE.name, grant: grant() });

    await expect(personMcpCredentials({ source: SOURCE, userId: ALEX })).resolves.toEqual({ ok: true, credentials: { baseUrl: URL, token: 'at-alex' } });

    const cass = await personMcpCredentials({ source: SOURCE, userId: CASS });

    expect(cass).toMatchObject({ ok: false, why: expect.stringContaining('/api/connect/mcp/start?workspace=proj-mcp-finance&source=company-knowledge') });
  });

  it('keeps the grant in the person\'s Personal, not the workspace that asked', async () => {
    await storePersonGrant({ userId: ALEX, sourceName: SOURCE.name, grant: grant() });
    const rows = await db.select({ orgId: apiTokenSchema.orgId, account: apiTokenSchema.account }).from(apiTokenSchema);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.orgId).not.toBe(SOURCE.orgId);
    expect(rows[0]!.account).toBe(URL);
  });

  it('refuses a turn with no person rather than borrowing a grant', async () => {
    await storePersonGrant({ userId: ALEX, sourceName: SOURCE.name, grant: grant() });

    await expect(personMcpCredentials({ source: SOURCE, userId: null })).resolves.toMatchObject({ ok: false, why: expect.stringContaining('nobody is in this turn') });
  });

  it('refreshes an expiring grant once and saves the rotated token', async () => {
    await storePersonGrant({ userId: ALEX, sourceName: SOURCE.name, grant: grant('2000-01-01T00:00:00.000Z') });

    await expect(personMcpCredentials({ source: SOURCE, userId: ALEX })).resolves.toEqual({ ok: true, credentials: { baseUrl: URL, token: 'at-new' } });
    await expect(personMcpCredentials({ source: SOURCE, userId: ALEX })).resolves.toEqual({ ok: true, credentials: { baseUrl: URL, token: 'at-new' } });
    expect(refresh.calls).toBe(1);
  });

  it('asks the person to sign in again when the refresh is refused', async () => {
    refresh.fail = true;
    await storePersonGrant({ userId: ALEX, sourceName: SOURCE.name, grant: grant('2000-01-01T00:00:00.000Z') });

    await expect(personMcpCredentials({ source: SOURCE, userId: ALEX })).resolves.toMatchObject({ ok: false, why: expect.stringContaining('sign in again') });
  });

  it('replaces the grant in place when the person signs in again', async () => {
    await storePersonGrant({ userId: ALEX, sourceName: SOURCE.name, grant: grant() });
    await storePersonGrant({ userId: ALEX, sourceName: SOURCE.name, grant: { ...grant(), token: 'at-second', accessToken: 'at-second' } });

    expect(await db.select({ id: apiTokenSchema.id }).from(apiTokenSchema)).toHaveLength(1);
    await expect(personMcpCredentials({ source: SOURCE, userId: ALEX })).resolves.toEqual({ ok: true, credentials: { baseUrl: URL, token: 'at-second' } });
  });
});
