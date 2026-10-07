/**
 * The workspaces a Slack mention may be routed to, against PGlite: the
 * account's shared workspaces the sender can act in, plus the channel's own —
 * and never anyone's personal workspace. Before 2026-10-07 every workspace on
 * the account was a candidate, whoever wrote the mention.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const {
  accountMembershipSchema,
  agentSchema,
  projectMemberSchema,
  projectSchema,
  tenantAccountSchema,
  userSchema,
} = await import('@/models/Schema');
const { ensurePersonalProject } = await import('@/services/workspace/personalProject');
const { accountCandidates } = await import('./workspaceRoute');

const NORTHWIND = 'acct-route-northwind';
const FERN = 'usr-route-fern';
const GUS = 'usr-route-gus';

const SUPPORT = 'proj-route-support'; // the channel's bound workspace
const FACTORY = 'proj-route-factory'; // Fern is granted
const FINANCE = 'proj-route-finance'; // nobody here is granted

beforeEach(async () => {
  process.env.VOCION_ENFORCE_WORKSPACE_ACCESS = '1';
  await db.delete(agentSchema);
  await db.delete(projectMemberSchema);
  await db.delete(projectSchema);
  await db.delete(accountMembershipSchema);
  await db.delete(userSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(tenantAccountSchema).values({ id: NORTHWIND, name: 'Northwind', slug: 'northwind-route' });
  await db.insert(userSchema).values([
    { id: FERN, email: 'fern@northwind.example' },
    { id: GUS, email: 'gus@northwind.example' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: NORTHWIND, userId: FERN, role: 'member' },
    { accountId: NORTHWIND, userId: GUS, role: 'member' },
  ]);
  await db.insert(projectSchema).values([
    { id: SUPPORT, accountId: NORTHWIND, slug: 'support', name: 'Support' },
    { id: FACTORY, accountId: NORTHWIND, slug: 'factory', name: 'Factory' },
    { id: FINANCE, accountId: NORTHWIND, slug: 'finance', name: 'Finance' },
  ]);
  await db.insert(projectMemberSchema).values({ projectId: FACTORY, userId: FERN, role: 'member' });
  await db.insert(agentSchema).values([SUPPORT, FACTORY, FINANCE].map(orgId => ({ orgId, projectId: orgId, slug: 'lead', name: `Lead of ${orgId}`, systemPrompt: 'x', role: 'lead', active: 'true' })));
  // Everyone's personal workspace has an agent (its assistant), which is what
  // made it look like a routable workspace.
  await ensurePersonalProject(FERN, NORTHWIND);
  await ensurePersonalProject(GUS, NORTHWIND);
});

afterEach(() => {
  delete process.env.VOCION_ENFORCE_WORKSPACE_ACCESS;
});

describe('accountCandidates', () => {
  it('offers the sender\'s own reach plus the channel\'s, and no personal workspace', async () => {
    const ids = (await accountCandidates(SUPPORT, { sender: async () => FERN, keep: [SUPPORT] })).map(c => c.orgId).sort();

    expect(ids).toEqual([FACTORY, SUPPORT].sort());
  });

  it('a sender Vocion does not know reaches only the channel\'s own', async () => {
    const ids = (await accountCandidates(SUPPORT, { sender: async () => null, keep: [SUPPORT] })).map(c => c.orgId);

    expect(ids).toEqual([SUPPORT]);
  });

  it('does not ask who the sender is when the channel already holds every workspace', async () => {
    const sender = vi.fn(async () => FERN);
    const ids = (await accountCandidates(SUPPORT, { sender, keep: [SUPPORT, FACTORY, FINANCE] })).map(c => c.orgId).sort();

    expect(ids).toEqual([FACTORY, FINANCE, SUPPORT].sort());
    expect(sender).not.toHaveBeenCalled();
  });

  it('unenforced, the sender reaches every shared workspace of the account — still no personal one', async () => {
    delete process.env.VOCION_ENFORCE_WORKSPACE_ACCESS;
    const ids = (await accountCandidates(SUPPORT, { sender: async () => GUS, keep: [SUPPORT] })).map(c => c.orgId).sort();

    expect(ids).toEqual([FACTORY, FINANCE, SUPPORT].sort());
  });
});
