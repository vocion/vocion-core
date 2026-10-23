/**
 * Your connections follow you, against PGlite: an `auth: person` server
 * declared anywhere in the Org joins a person's own turn in any workspace of
 * that Org, and nothing else's.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, knowledgeSourceSchema, projectMemberSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { ensurePersonalProject } = await import('@/services/workspace/personalProject');
const { setPersonGrantEveryWorkspace, storePersonGrant } = await import('./personSignIn');
const { followingMcpSources, membersOwnConnectionsOn, setMembersOwnConnections, yourOrgConnections } = await import('./followingSources');

const NORTHWIND = 'acct-fol-northwind';
const KESTREL = 'acct-fol-kestrel';
const ALEX = 'usr-fol-alex';
const CASS = 'usr-fol-cass';
const BLAIR = 'usr-fol-blair';
const FINANCE = 'proj-fol-finance';
const REVENUE = 'proj-fol-revenue';
const DELIVERY = 'proj-fol-delivery';
const KESTREL_OPS = 'proj-fol-kestrel-ops';
const KNOWLEDGE = 'https://knowledge.northwind.example/mcp';
const KESTREL_KB = 'https://kb.kestrel.example/mcp';
const CASS_ONLY = 'https://notes.cass.example/mcp';
let cassPersonal = '';

function grant(url: string) {
  return { baseUrl: url, token: 'at', accessToken: 'at', refreshToken: 'rt', expiresAt: '2099-01-01T00:00:00.000Z', clientId: 'client-1', resource: url };
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values([
    { id: NORTHWIND, name: 'Northwind', slug: 'northwind-fol' },
    { id: KESTREL, name: 'Kestrel Capital', slug: 'kestrel-fol' },
  ]);
  await db.insert(userSchema).values([
    { id: ALEX, email: 'alex@northwind.example', name: 'Alex Rivera' },
    { id: CASS, email: 'cass@northwind.example', name: 'Cass Lund' },
    { id: BLAIR, email: 'blair@kestrel.example', name: 'Blair Okafor' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: NORTHWIND, userId: ALEX, role: 'member' },
    { accountId: NORTHWIND, userId: CASS, role: 'member' },
    { accountId: KESTREL, userId: BLAIR, role: 'member' },
  ]);
  await db.insert(projectSchema).values([
    { id: FINANCE, accountId: NORTHWIND, slug: 'finance-fol', name: 'Finance' },
    { id: REVENUE, accountId: NORTHWIND, slug: 'revenue-fol', name: 'Revenue' },
    { id: DELIVERY, accountId: NORTHWIND, slug: 'delivery-fol', name: 'Delivery' },
    { id: KESTREL_OPS, accountId: KESTREL, slug: 'ops-fol', name: 'Kestrel Ops' },
  ]);
  await db.insert(projectMemberSchema).values([
    { projectId: REVENUE, userId: ALEX, role: 'member', source: 'direct', addedBy: ALEX },
    { projectId: REVENUE, userId: CASS, role: 'member', source: 'direct', addedBy: CASS },
    { projectId: KESTREL_OPS, userId: BLAIR, role: 'member', source: 'direct', addedBy: BLAIR },
  ]);
  cassPersonal = (await ensurePersonalProject(CASS, NORTHWIND)).id;
  await ensurePersonalProject(ALEX, NORTHWIND);
  await db.insert(knowledgeSourceSchema).values([
    // Finance declares the per-person server; a workspace-token server never follows.
    { orgId: FINANCE, slug: 'company-knowledge', kind: 'plugin', configJson: { _connector: 'mcp', _name: 'Company Knowledge', auth: 'person', url: KNOWLEDGE, readTools: ['search_knowledge', 'get_document'] } },
    { orgId: FINANCE, slug: 'ledger', kind: 'plugin', configJson: { _connector: 'mcp', _name: 'Ledger', readTools: ['read'] } },
    // Delivery uses the same slug for something else: the follower is renamed there.
    { orgId: DELIVERY, slug: 'company-knowledge', kind: 'plugin', configJson: { _connector: 'web', _name: 'Company site' } },
    // Another Org's server, and a server only in Cass's own Personal.
    { orgId: KESTREL_OPS, slug: 'kestrel-kb', kind: 'plugin', configJson: { _connector: 'mcp', _name: 'Kestrel KB', auth: 'person', url: KESTREL_KB, readTools: ['search'] } },
    { orgId: cassPersonal, slug: 'cass-notes', kind: 'plugin', configJson: { _connector: 'mcp', _name: 'Cass notes', auth: 'person', url: CASS_ONLY, readTools: ['search'] } },
  ]);
});

describe('your connections follow you', () => {
  it('joins the person\'s own turn in a workspace of the Org that never declared it, read-only, signed in or not', async () => {
    await expect(followingMcpSources({ userId: ALEX, orgId: REVENUE, personTurn: true })).resolves.toEqual([
      { slug: 'company-knowledge', name: 'Company Knowledge', url: KNOWLEDGE, readTools: ['search_knowledge', 'get_document'], fromOrgId: FINANCE, fromWorkspace: 'Finance' },
    ]);
  });

  it('never joins a mission, an automation or any turn nobody started', async () => {
    await expect(followingMcpSources({ userId: ALEX, orgId: REVENUE })).resolves.toEqual([]);
    await expect(followingMcpSources({ userId: ALEX, orgId: REVENUE, personTurn: false })).resolves.toEqual([]);
    await expect(followingMcpSources({ userId: undefined, orgId: REVENUE, personTurn: true })).resolves.toEqual([]);
  });

  it('stays in its Org, and never reads another person\'s Personal', async () => {
    const blair = await followingMcpSources({ userId: BLAIR, orgId: KESTREL_OPS, personTurn: true });

    expect(blair.map(s => s.url)).toEqual([KESTREL_KB]);

    const alex = await followingMcpSources({ userId: ALEX, orgId: REVENUE, personTurn: true });

    expect(alex.map(s => s.url)).not.toContain(KESTREL_KB);
    expect(alex.map(s => s.url)).not.toContain(CASS_ONLY);
    await expect(followingMcpSources({ userId: ALEX, orgId: cassPersonal, personTurn: true })).resolves.toEqual([]);
  });

  it('counts the person\'s own Personal as declared in the Org', async () => {
    const cass = await followingMcpSources({ userId: CASS, orgId: REVENUE, personTurn: true });

    expect(cass.map(s => s.url).sort()).toEqual([CASS_ONLY, KNOWLEDGE].sort());
  });

  it('never shadows a source the workspace already names with that slug', async () => {
    const [delivery] = await followingMcpSources({ userId: ALEX, orgId: DELIVERY, personTurn: true });

    expect(delivery).toMatchObject({ slug: 'company-knowledge-yours', url: KNOWLEDGE });
  });

  it('stops when the workspace admin turns members\' own connections off', async () => {
    await setMembersOwnConnections(REVENUE, false);

    await expect(membersOwnConnectionsOn(REVENUE)).resolves.toBe(false);
    await expect(followingMcpSources({ userId: ALEX, orgId: REVENUE, personTurn: true })).resolves.toEqual([]);

    await setMembersOwnConnections(REVENUE, true);

    await expect(followingMcpSources({ userId: ALEX, orgId: REVENUE, personTurn: true })).resolves.toHaveLength(1);
  });

  it('stays where it is declared when the person turns "Use in every workspace" off, for them only', async () => {
    await storePersonGrant({ userId: ALEX, sourceName: 'Company Knowledge', grant: grant(KNOWLEDGE) as never });

    await expect(setPersonGrantEveryWorkspace(ALEX, KNOWLEDGE, false)).resolves.toBe(true);
    await expect(followingMcpSources({ userId: ALEX, orgId: REVENUE, personTurn: true })).resolves.toEqual([]);
    await expect(followingMcpSources({ userId: CASS, orgId: REVENUE, personTurn: true })).resolves.toHaveLength(2);

    const listed = await yourOrgConnections({ userId: ALEX, accountId: NORTHWIND });

    expect(listed.find(s => s.url === KNOWLEDGE)).toMatchObject({ signedIn: true, everyWorkspace: false });

    await setPersonGrantEveryWorkspace(ALEX, KNOWLEDGE, true);

    await expect(followingMcpSources({ userId: ALEX, orgId: REVENUE, personTurn: true })).resolves.toHaveLength(1);
  });

  it('keeps no choice for a person who has not signed in', async () => {
    await expect(setPersonGrantEveryWorkspace(CASS, KNOWLEDGE, false)).resolves.toBe(false);

    const [row] = await db.select({ on: projectSchema.membersOwnConnections }).from(projectSchema).where(eq(projectSchema.id, FINANCE));

    expect(row?.on).toBe(true);
  });
});
