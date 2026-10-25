/**
 * The workspace's accountable person, on PGlite: an app install makes the
 * installing admin accountable when nobody is, admins can change it, and a
 * delivery with nobody to send to asks an admin once. Every name is fictional.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, askSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { ACCOUNTABLE_ASK_REF, AccountableError, askForAccountable, defaultAccountable, personFrom, readAccountable, setAccountable } = await import('./accountable');
const { deliverCheckResult } = await import('@/services/missions/deliver');
const { togglePluginForProject } = await import('@/services/PluginService');

const ACCOUNT = 'acct-accountable';
const OTHER = 'acct-accountable-other';
const EMPTY = 'proj_acc_harbor';
const HELD = 'proj_acc_kestrel';
const CLOUD = 'proj_acc_northwind';
const MARA = 'usr-acc-mara';
const TEO = 'usr-acc-teo';
const STRANGER = 'usr-acc-stranger';

const accountableOf = async (orgId: string) => (await db.select({ id: projectSchema.accountableUserId }).from(projectSchema).where(eq(projectSchema.id, orgId)))[0]?.id ?? null;
const openAsks = async (orgId: string) => db.select().from(askSchema).where(and(eq(askSchema.orgId, orgId), eq(askSchema.sourceRef, ACCOUNTABLE_ASK_REF), eq(askSchema.status, 'open')));

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values([
    { id: ACCOUNT, name: 'Northwind', slug: 'northwind-acc' },
    { id: OTHER, name: 'Elsewhere', slug: 'elsewhere-acc' },
  ]);
  await db.insert(userSchema).values([
    { id: MARA, email: 'mara@northwind.example', name: 'Mara Quill' },
    { id: TEO, email: 'teo@northwind.example', name: 'Teo Vance' },
    { id: STRANGER, email: 'stranger@elsewhere.example' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: ACCOUNT, userId: MARA, role: 'admin' },
    { accountId: ACCOUNT, userId: TEO, role: 'member' },
    { accountId: OTHER, userId: STRANGER, role: 'admin' },
  ]);
  await db.insert(projectSchema).values([
    { id: EMPTY, accountId: ACCOUNT, slug: 'harbor', name: 'Harbor' },
    { id: HELD, accountId: ACCOUNT, slug: 'kestrel', name: 'Kestrel', accountableUserId: TEO },
    { id: CLOUD, accountId: ACCOUNT, slug: 'northwind', name: 'Northwind', timeZone: 'America/Los_Angeles', leadAgentSlug: 'workspace-lead' },
  ]);
});

describe('who an installer is', () => {
  it('reads a person from user:<id> or a bare id, and nobody from a system actor', () => {
    expect(personFrom('user:usr-1')).toBe('usr-1');
    expect(personFrom('usr-1')).toBe('usr-1');
    expect(personFrom('ui-apps')).toBe('ui-apps');
    expect(personFrom('agent:marketing-lead')).toBeNull();
    expect(personFrom('')).toBeNull();
    expect(personFrom(null)).toBeNull();
  });
});

describe('an app install makes the installer accountable', () => {
  it('when nobody is, and only a member of the workspace\'s Org', async () => {
    expect(await defaultAccountable(EMPTY, `user:${STRANGER}`)).toBeNull();
    expect(await accountableOf(EMPTY)).toBeNull();

    expect(await defaultAccountable(EMPTY, `user:${MARA}`)).toBe(MARA);
    expect(await accountableOf(EMPTY)).toBe(MARA);
  });

  it('never replaces a person already accountable', async () => {
    expect(await defaultAccountable(HELD, `user:${MARA}`)).toBeNull();
    expect(await accountableOf(HELD)).toBe(TEO);
  });

  it('through the one-click install, and says so', async () => {
    const res = await togglePluginForProject({ orgId: CLOUD, projectSlug: 'northwind', workspaceDir: null, slug: 'marketing', enabled: true, appliedBy: `user:${MARA}` });

    expect(res.installed).toMatchObject({ plugins: ['marketing'], accountableSet: MARA });
    expect(res.note).toContain('accountable person');
    expect(await accountableOf(CLOUD)).toBe(MARA);
  });
});

describe('an admin names the accountable person', () => {
  it('a member of the Org, and refuses anyone else', async () => {
    await expect(setAccountable({ orgId: HELD, userId: STRANGER })).rejects.toBeInstanceOf(AccountableError);

    const person = await setAccountable({ orgId: HELD, userId: MARA });

    expect(person).toMatchObject({ userId: MARA, name: 'Mara Quill', email: 'mara@northwind.example' });
    expect(await readAccountable(HELD)).toMatchObject({ userId: MARA });
  });
});

describe('a delivery with nobody to send to', () => {
  it('asks an admin once, and naming someone closes the ask', async () => {
    const ORPHAN = 'proj_acc_orphan';
    await db.insert(projectSchema).values({ id: ORPHAN, accountId: ACCOUNT, slug: 'orphan', name: 'Orphan' });

    const failed = { orgId: ORPHAN, mission: { name: 'Daily marketing update', agentSlug: 'marketing-lead', deliver: { email: true as const } }, runId: 1, failed: 'the model timed out', startedAt: new Date() };
    const outcome = await deliverCheckResult(failed);

    expect(outcome).toMatchObject({ delivered: 'failure-note', mail: { sent: false } });

    await deliverCheckResult(failed);
    await askForAccountable(ORPHAN, 'Daily marketing update');
    const asks = await openAsks(ORPHAN);

    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ kind: 'setup', ownerUserId: MARA, contextUrl: '/dashboard/members' });
    expect(asks[0]!.body).toContain('Daily marketing update');

    await setAccountable({ orgId: ORPHAN, userId: TEO });

    expect(await openAsks(ORPHAN)).toHaveLength(0);
  });
});
