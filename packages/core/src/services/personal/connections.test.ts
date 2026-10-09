/**
 * A person's own connections, against PGlite: who may connect, whose
 * credential a read gets, and that a grant leaves with its person.
 *
 * The rule under test is that a personal grant is the person's: it is found
 * only from their own Personal workspace, only for them, only while their Org
 * allows personal connections, and it is gone — not revoked, gone — when they
 * disconnect it, leave the Org, or are deleted.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, apiTokenSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { storeLoginCredential } = await import('@/services/ApiTokenService');
const { ensurePersonalProject } = await import('@/services/workspace/personalProject');
const { removeMember } = await import('@/services/MembersService');
const svc = await import('./connections');

const ACCOUNT = 'acct-pc-northwind';
const ALEX = 'usr-pc-alex';
const CASS = 'usr-pc-cass';
const SHARED = 'proj-pc-revenue';
const GMAIL_SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose openid email';

let alexHome: string;
let cassHome: string;

async function connectGoogle(orgId: string, userId: string, email: string, scope = GMAIL_SCOPES) {
  return storeLoginCredential({ orgId, platform: 'google', name: `Google — ${email}`, account: email, values: { refreshToken: `rt-${userId}`, accessToken: `at-${userId}`, expiresAt: '2099-01-01T00:00:00Z', scope, email }, createdBy: userId });
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Northwind', slug: 'northwind-pc' });
  await db.insert(userSchema).values([
    { id: ALEX, email: 'alex@northwind.example', name: 'Alex Rivera' },
    { id: CASS, email: 'cass@northwind.example', name: 'Cass Lund' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: ACCOUNT, userId: ALEX, role: 'admin' },
    { accountId: ACCOUNT, userId: CASS, role: 'member' },
  ]);
  await db.insert(projectSchema).values({ id: SHARED, accountId: ACCOUNT, slug: 'revenue-pc', name: 'Revenue Team' });
  alexHome = (await ensurePersonalProject(ALEX, ACCOUNT)).id;
  cassHome = (await ensurePersonalProject(CASS, ACCOUNT)).id;
});

beforeEach(async () => {
  await db.update(tenantAccountSchema).set({ personalConnections: true }).where(eq(tenantAccountSchema.id, ACCOUNT));
});

afterEach(async () => {
  await db.delete(apiTokenSchema);
  vi.unstubAllGlobals();
});

describe('whose workspace is personal', () => {
  it('is the owner\'s own Personal workspace, and nothing else', async () => {
    await expect(svc.ownPersonalWorkspace(alexHome, ALEX)).resolves.toEqual({ projectId: alexHome, accountId: ACCOUNT });
    await expect(svc.ownPersonalWorkspace(cassHome, ALEX)).resolves.toBeNull();
    await expect(svc.ownPersonalWorkspace(SHARED, ALEX)).resolves.toBeNull();
    await expect(svc.ownPersonalWorkspace('proj-nope', ALEX)).resolves.toBeNull();
  });
});

describe('the personal connect gate', () => {
  it('lets a member connect a personal connection in their own workspace, with no admin role', async () => {
    const gate = await svc.personalConnectGate({ orgId: cassHome, userId: CASS, connectorSlug: 'gmail' });

    expect(gate).toMatchObject({ ok: true, accountId: ACCOUNT, connection: { connector: 'gmail', provider: 'google' } });
  });

  it('refuses someone else\'s Personal workspace, a shared one, and a connector the personal list does not name', async () => {
    await expect(svc.personalConnectGate({ orgId: alexHome, userId: CASS, connectorSlug: 'gmail' })).resolves.toMatchObject({ ok: false, reason: 'wrong_person' });
    await expect(svc.personalConnectGate({ orgId: SHARED, userId: CASS, connectorSlug: 'gmail' })).resolves.toMatchObject({ ok: false, reason: 'wrong_person' });
    await expect(svc.personalConnectGate({ orgId: cassHome, userId: CASS, connectorSlug: 'hubspot' })).resolves.toMatchObject({ ok: false, reason: 'not_personal' });
  });

  it('refuses everyone once the Org turns personal connections off', async () => {
    await svc.setPersonalConnectionsAllowed(ACCOUNT, false);

    await expect(svc.personalConnectGate({ orgId: cassHome, userId: CASS, connectorSlug: 'gmail' })).resolves.toMatchObject({ ok: false, status: 403, reason: 'personal_off' });
  });
});

describe('reading a personal credential — one person\'s grant never answers another\'s turn', () => {
  it('gives each person their own login, from their own workspace', async () => {
    await connectGoogle(alexHome, ALEX, 'alex@northwind.example');
    await connectGoogle(cassHome, CASS, 'cass@northwind.example');

    const alex = await svc.personalCredential({ orgId: alexHome, userId: ALEX, connector: 'gmail' });
    const cass = await svc.personalCredential({ orgId: cassHome, userId: CASS, connector: 'gmail' });

    expect(alex).toMatchObject({ ok: true, orgId: alexHome, values: { refreshToken: `rt-${ALEX}`, email: 'alex@northwind.example' } });
    expect(cass).toMatchObject({ ok: true, orgId: cassHome, values: { refreshToken: `rt-${CASS}`, email: 'cass@northwind.example' } });
  });

  it('never hands Alex\'s login to Cass, even with Alex\'s workspace named', async () => {
    await connectGoogle(alexHome, ALEX, 'alex@northwind.example');

    const crossed = await svc.personalCredential({ orgId: alexHome, userId: CASS, connector: 'gmail' });
    const ownButEmpty = await svc.personalCredential({ orgId: cassHome, userId: CASS, connector: 'gmail' });

    expect(crossed.ok).toBe(false);
    expect(ownButEmpty).toMatchObject({ ok: false, why: expect.stringContaining('not connected') });
  });

  it('never reads a personal grant from a shared workspace', async () => {
    await connectGoogle(alexHome, ALEX, 'alex@northwind.example');

    await expect(svc.personalCredential({ orgId: SHARED, userId: ALEX, connector: 'gmail' })).resolves.toMatchObject({ ok: false });
  });

  it('a Google login made for Drive alone does not serve Gmail', async () => {
    await connectGoogle(alexHome, ALEX, 'alex@northwind.example', 'https://www.googleapis.com/auth/drive.readonly openid email');

    await expect(svc.personalCredential({ orgId: alexHome, userId: ALEX, connector: 'gmail' })).resolves.toMatchObject({ ok: false });
    await expect(svc.personalCredential({ orgId: alexHome, userId: ALEX, connector: 'drive' })).resolves.toMatchObject({ ok: true });
  });

  it('stops every read once the Org turns personal connections off', async () => {
    await connectGoogle(alexHome, ALEX, 'alex@northwind.example');
    await svc.setPersonalConnectionsAllowed(ACCOUNT, false);

    await expect(svc.personalCredential({ orgId: alexHome, userId: ALEX, connector: 'gmail' })).resolves.toEqual({ ok: false, why: svc.PERSONAL_CONNECTIONS_OFF });
  });
});

describe('Personal connectors', () => {
  it('lists every connection with the account it is connected as, and no token', async () => {
    await connectGoogle(alexHome, ALEX, 'alex@northwind.example');

    const rows = await svc.listPersonalConnections({ projectId: alexHome, accountId: ACCOUNT });

    expect(rows.map(r => r.connector)).toEqual(['gmail', 'google-calendar', 'drive', 'slack', 'github']);
    expect(rows.find(r => r.connector === 'gmail')).toMatchObject({ account: 'alex@northwind.example', brand: 'gmail' });
    // This login was granted Gmail only, so Calendar reads as not connected.
    expect(rows.find(r => r.connector === 'google-calendar')?.account).toBeNull();
    expect(JSON.stringify(rows)).not.toContain('rt-');
  });
});

describe('a grant leaves with its person', () => {
  it('disconnecting deletes the grant and withdraws it at Google', async () => {
    const revoked: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      revoked.push(`${url} ${String(init.body)}`);
      return new Response('{}', { status: 200 });
    }));
    await connectGoogle(alexHome, ALEX, 'alex@northwind.example');

    const removed = await svc.disconnectPersonalConnection({ projectId: alexHome, accountId: ACCOUNT }, 'gmail');

    expect(removed).toBe(1);
    expect(await db.select().from(apiTokenSchema).where(eq(apiTokenSchema.orgId, alexHome))).toEqual([]);
    expect(revoked).toEqual([`https://oauth2.googleapis.com/revoke token=rt-${ALEX}`]);
  });

  it('a vendor that does not answer never keeps the grant here', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));
    await connectGoogle(alexHome, ALEX, 'alex@northwind.example');

    await expect(svc.disconnectPersonalConnection({ projectId: alexHome, accountId: ACCOUNT }, 'gmail')).resolves.toBe(1);
  });

  it('leaving the Org deletes every credential in their Personal workspace, and nobody else\'s', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    await connectGoogle(alexHome, ALEX, 'alex@northwind.example');
    await connectGoogle(cassHome, CASS, 'cass@northwind.example');

    await removeMember({ accountId: ACCOUNT, userId: CASS });

    expect(await db.select().from(apiTokenSchema).where(eq(apiTokenSchema.orgId, cassHome))).toEqual([]);
    expect(await db.select().from(apiTokenSchema).where(eq(apiTokenSchema.orgId, alexHome))).toHaveLength(1);

    await db.insert(accountMembershipSchema).values({ accountId: ACCOUNT, userId: CASS, role: 'member' });
  });

  it('a deleted person\'s grants are deleted by the database itself (0202)', async () => {
    const DORA = 'usr-pc-dora';
    await db.insert(userSchema).values({ id: DORA, email: 'dora@northwind.example', name: 'Dora Kim' });
    await db.insert(accountMembershipSchema).values({ accountId: ACCOUNT, userId: DORA, role: 'member' });
    const doraHome = (await ensurePersonalProject(DORA, ACCOUNT)).id;
    await connectGoogle(doraHome, DORA, 'dora@northwind.example');

    await db.delete(userSchema).where(eq(userSchema.id, DORA));

    expect(await db.select().from(apiTokenSchema).where(eq(apiTokenSchema.orgId, doraHome))).toEqual([]);
  });
});
