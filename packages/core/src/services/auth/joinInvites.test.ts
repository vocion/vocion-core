/**
 * Invites joined at the end of every sign-in (real rows, PGlite). Sam has a
 * login and is in Northwind; Kestrel Capital and Contoso invite him later.
 *
 * Pinned: on a multi-Org server every Org's open invite to the login's
 * address is joined (whatever its case), never an Org he is already in, never
 * an expired or used invite; on a single-Org server someone already in an Org
 * joins nothing new, and someone in no Org joins only the Org of the invite
 * that expires first; the Orgs come back by name; it never throws; and each
 * Org joined is told to him as an `org-joined` notification in that Org's
 * workspace, naming the workspaces he now opens there.
 */
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// The Org rule reads the extension seam; a test flips it to multi-Org.
const orgs = vi.hoisted(() => ({ multi: false }));
vi.mock('@vocion/enterprise/index', () => ({
  extensions: [{ name: 'test-orgs', orgs: { multiOrg: () => orgs.multi } }],
}));
// The real acceptance, wrapped so one test can make it throw.
vi.mock('@/services/InviteAcceptance', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/InviteAcceptance')>();
  return { ...real, acceptInviteAsExistingUser: vi.fn(real.acceptInviteAsExistingUser) };
});

const { db } = await import('@/libs/DB');
const schema = await import('@/models/Schema');
const { acceptInviteAsExistingUser } = await import('@/services/InviteAcceptance');
const { joinedBody, joinPendingInvites, pendingInvitationsFor, tellInvitee, tellJoined } = await import('./joinInvites');

const NOW = new Date();
const DAY = 24 * 60 * 60 * 1000;
const SAM = 'usr-sam';

async function samsOrgs(): Promise<string[]> {
  const rows = await db.select().from(schema.accountMembershipSchema).where(eq(schema.accountMembershipSchema.userId, SAM));
  return rows.map(r => `${r.accountId}:${r.role}`).sort();
}

async function invite(id: string, accountId: string, over: Partial<typeof schema.inviteSchema.$inferInsert> = {}) {
  await db.insert(schema.inviteSchema).values({
    id,
    accountId,
    email: 'sam@northwind.example',
    role: 'member',
    token: `tok-${id}`,
    expiresAt: new Date(NOW.getTime() + 7 * DAY),
    ...over,
  });
}

beforeEach(async () => {
  orgs.multi = false;
  vi.mocked(acceptInviteAsExistingUser).mockClear();
  await db.delete(schema.notificationDeliverySchema);
  await db.delete(schema.notificationSchema);
  await db.delete(schema.eventLogSchema);
  await db.delete(schema.inviteSchema);
  await db.delete(schema.accountMembershipSchema);
  await db.delete(schema.projectSchema);
  await db.delete(schema.tenantAccountSchema);
  await db.delete(schema.userSchema);
  await db.insert(schema.tenantAccountSchema).values([
    { id: 'acct-northwind', name: 'Northwind', slug: 'northwind' },
    { id: 'acct-kestrel', name: 'Kestrel Capital', slug: 'kestrel' },
    { id: 'acct-contoso', name: 'Contoso', slug: 'contoso' },
  ]);
  await db.insert(schema.userSchema).values({ id: SAM, email: 'sam@northwind.example', name: 'Sam', passwordHash: 'hash' });
});

describe('joinPendingInvites — multi-Org', () => {
  beforeEach(async () => {
    orgs.multi = true;
    await db.insert(schema.accountMembershipSchema).values({ accountId: 'acct-northwind', userId: SAM, role: 'admin' });
  });

  it('joins every Org that invited the login\'s address, whatever its case, and names them', async () => {
    await invite('k', 'acct-kestrel', { email: 'Sam@Northwind.EXAMPLE', role: 'admin', expiresAt: new Date(NOW.getTime() + 2 * DAY) });
    await invite('c', 'acct-contoso', { expiresAt: new Date(NOW.getTime() + 5 * DAY) });

    const joined = await joinPendingInvites(SAM, NOW);

    expect(joined.map(o => o.name)).toEqual(['Kestrel Capital', 'Contoso']);
    expect(await samsOrgs()).toEqual(['acct-contoso:member', 'acct-kestrel:admin', 'acct-northwind:admin']);

    const spent = await db.select().from(schema.inviteSchema);

    expect(spent.every(i => i.acceptedAt instanceof Date)).toBe(true);
  });

  it('leaves an invite to an Org he is already in alone', async () => {
    await invite('n', 'acct-northwind');

    expect(await joinPendingInvites(SAM, NOW)).toEqual([]);
    expect(acceptInviteAsExistingUser).not.toHaveBeenCalled();
    expect(await samsOrgs()).toEqual(['acct-northwind:admin']);
  });

  it('never joins an expired or used invite, or one to someone else', async () => {
    await invite('old', 'acct-kestrel', { expiresAt: new Date(NOW.getTime() - DAY) });
    await invite('used', 'acct-contoso', { acceptedAt: new Date(NOW.getTime() - DAY) });
    await invite('other', 'acct-kestrel', { email: 'dana@northwind.example', token: 'tok-other' });

    expect(await joinPendingInvites(SAM, NOW)).toEqual([]);
    expect(await samsOrgs()).toEqual(['acct-northwind:admin']);
  });
});

describe('joinPendingInvites — single-Org', () => {
  it('joins nothing new for someone already in an Org', async () => {
    await db.insert(schema.accountMembershipSchema).values({ accountId: 'acct-northwind', userId: SAM, role: 'member' });
    await invite('k', 'acct-kestrel');

    expect(await joinPendingInvites(SAM, NOW)).toEqual([]);
    expect(await samsOrgs()).toEqual(['acct-northwind:member']);

    const [kestrel] = await db.select().from(schema.inviteSchema).where(eq(schema.inviteSchema.id, 'k'));

    expect(kestrel?.acceptedAt).toBeNull();
  });

  it('for someone in no Org, joins only the Org of the invite that expires first', async () => {
    await invite('k', 'acct-kestrel', { expiresAt: new Date(NOW.getTime() + 9 * DAY) });
    await invite('c', 'acct-contoso', { expiresAt: new Date(NOW.getTime() + 3 * DAY) });

    const joined = await joinPendingInvites(SAM, NOW);

    expect(joined).toEqual([{ accountId: 'acct-contoso', name: 'Contoso' }]);
    expect(await samsOrgs()).toEqual(['acct-contoso:member']);
  });
});

describe('joinPendingInvites — never stops a sign-in', () => {
  it('answers no Orgs when accepting throws', async () => {
    orgs.multi = true;
    await invite('k', 'acct-kestrel');
    vi.mocked(acceptInviteAsExistingUser).mockRejectedValueOnce(new Error('invite store down'));

    await expect(joinPendingInvites(SAM, NOW)).resolves.toEqual([]);
  });

  it('answers no Orgs for a login that no longer exists', async () => {
    await expect(joinPendingInvites('usr-gone', NOW)).resolves.toEqual([]);
  });
});

describe('telling the person what they joined', () => {
  it('names the workspaces they open there, or says an admin gives access', () => {
    expect(joinedBody(['Deals', 'Personal'])).toBe('Your workspaces there: Deals, Personal.');
    expect(joinedBody([])).toBe('An admin there gives you access to its workspaces.');
  });

  it('lands an org-joined notification in the joined Org\'s workspace, naming its workspaces', async () => {
    orgs.multi = true;
    await db.insert(schema.accountMembershipSchema).values({ accountId: 'acct-northwind', userId: SAM, role: 'admin' });
    await db.insert(schema.projectSchema).values({ id: 'proj-kestrel-deals', accountId: 'acct-kestrel', slug: 'kestrel-deals', name: 'Deals' });
    await invite('k', 'acct-kestrel');

    await joinPendingInvites(SAM, NOW);

    const kestrelProjects = (await db.select().from(schema.projectSchema).where(eq(schema.projectSchema.accountId, 'acct-kestrel'))).map(p => p.id);
    const rows = await db.select().from(schema.notificationSchema).where(and(eq(schema.notificationSchema.userId, SAM), eq(schema.notificationSchema.kind, 'org-joined')));

    expect(rows).toHaveLength(1);
    expect(kestrelProjects).toContain(rows[0]!.orgId);
    expect(rows[0]).toMatchObject({ title: 'You joined Kestrel Capital', eventType: 'account.org_joined' });
    expect(rows[0]!.body).toMatch(/^Your workspaces there: .*Deals/);
  });

  it('says nothing for nothing joined, and never throws for an Org with no workspace to land in', async () => {
    await expect(tellJoined(SAM, [])).resolves.toBeUndefined();
    await expect(tellJoined(SAM, [{ accountId: 'acct-kestrel', name: 'Kestrel Capital' }])).resolves.toBeUndefined();
    expect(await db.select().from(schema.notificationSchema)).toHaveLength(0);
  });
});

describe('pendingInvitationsFor — the profile\'s Invitations', () => {
  beforeEach(async () => {
    await db.insert(schema.accountMembershipSchema).values({ accountId: 'acct-northwind', userId: SAM, role: 'admin' });
  });

  it('lists the open invites to Orgs he is not in, each joinable on a multi-Org server', async () => {
    orgs.multi = true;
    await invite('k', 'acct-kestrel', { role: 'admin' });
    await invite('n', 'acct-northwind');
    await invite('old', 'acct-contoso', { expiresAt: new Date(NOW.getTime() - DAY) });

    const listed = await pendingInvitationsFor(SAM, NOW);

    expect(listed).toEqual([expect.objectContaining({ token: 'tok-k', orgName: 'Kestrel Capital', role: 'admin', problem: null })]);
  });

  it('says why on a single-Org server, where a second Org cannot be joined', async () => {
    await invite('k', 'acct-kestrel');

    const [listed] = await pendingInvitationsFor(SAM, NOW);

    expect(listed?.problem).toMatch(/single Org/);
  });
});

describe('tellInvitee — an invite to a login that already exists', () => {
  it('lands an org-invited notification where he works, opening his profile', async () => {
    orgs.multi = true;
    await db.insert(schema.accountMembershipSchema).values({ accountId: 'acct-northwind', userId: SAM, role: 'admin' });
    await db.insert(schema.projectSchema).values({ id: 'proj-northwind-ops', accountId: 'acct-northwind', slug: 'northwind-ops', name: 'Northwind Ops' });
    await invite('k', 'acct-kestrel');

    await tellInvitee({ email: 'Sam@Northwind.example', accountId: 'acct-kestrel', inviteId: 'k' });

    const [note] = await db.select().from(schema.notificationSchema).where(eq(schema.notificationSchema.userId, SAM));

    expect(note).toMatchObject({ kind: 'org-invited', title: 'Kestrel Capital invited you to join', orgId: 'proj-northwind-ops' });
    expect(note?.link).toBe('/w/northwind-ops/dashboard/profile');
  });

  it('tells nobody when the address has no login — the invite email is how they hear', async () => {
    await tellInvitee({ email: 'dana@northwind.example', accountId: 'acct-kestrel', inviteId: 'k' });

    expect(await db.select().from(schema.notificationSchema)).toHaveLength(0);
  });
});
