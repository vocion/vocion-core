/**
 * Needs you across workspaces, against PGlite: which workspaces are read (the
 * person's own and the shared ones they reach; never someone else's personal
 * one, never another account's), how rows are tagged and linked, the "yours
 * first" order, the cap, a workspace that cannot be read, and that the number
 * of queries is bounded by the workspaces rather than by the rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { inArray } = await import('drizzle-orm');
const { accountMembershipSchema, actionRunSchema, askSchema, projectMemberSchema, projectSchema, reviewAssignmentSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { ensurePersonalProject } = await import('@/services/workspace/personalProject');
const { listInboxForUser, needsYouCountForUser, byYoursThenAge } = await import('./acrossWorkspaces');

const NORTHWIND = 'acct-across-northwind';
const CONTOSO = 'acct-across-contoso';
const RILEY = 'usr-across-riley';
const SAM = 'usr-across-sam';
const FACTORY = 'proj-across-factory';
const REVENUE = 'proj-across-revenue';
const SUPPLY = 'proj-across-supply';

let rileyPersonal: string;
let samPersonal: string;

const day = (n: number) => new Date(Date.UTC(2026, 9, n, 9, 0, 0));

async function ask(orgId: string, title: string, at: Date, createdBy: string | null = 'agent:revenue-lead') {
  await db.insert(askSchema).values({ orgId, kind: 'approval', title, status: 'open', createdBy, createdAt: at, updatedAt: at });
}

beforeEach(async () => {
  delete process.env.VOCION_ENFORCE_WORKSPACE_ACCESS;
  delete process.env.NEXT_PUBLIC_APP_URL;
  await db.delete(reviewAssignmentSchema);
  await db.delete(actionRunSchema);
  await db.delete(askSchema);
  await db.delete(projectMemberSchema);
  await db.delete(projectSchema).where(inArray(projectSchema.accountId, [NORTHWIND, CONTOSO]));
  await db.delete(accountMembershipSchema).where(inArray(accountMembershipSchema.accountId, [NORTHWIND, CONTOSO]));
  await db.delete(userSchema).where(inArray(userSchema.id, [RILEY, SAM]));
  await db.delete(tenantAccountSchema).where(inArray(tenantAccountSchema.id, [NORTHWIND, CONTOSO]));

  await db.insert(tenantAccountSchema).values([{ id: NORTHWIND, name: 'Northwind', slug: 'northwind' }, { id: CONTOSO, name: 'Contoso Supply', slug: 'contoso' }]);
  await db.insert(userSchema).values([{ id: RILEY, email: 'riley@northwind.example', name: 'Riley' }, { id: SAM, email: 'sam@northwind.example', name: 'Sam' }]);
  await db.insert(accountMembershipSchema).values([
    { accountId: NORTHWIND, userId: RILEY, role: 'member' },
    { accountId: NORTHWIND, userId: SAM, role: 'member' },
    // Only Sam is in Contoso: Riley must never see Contoso's queue.
    { accountId: CONTOSO, userId: SAM, role: 'member' },
  ]);
  await db.insert(projectSchema).values([
    { id: FACTORY, accountId: NORTHWIND, slug: 'factory', name: 'Northwind Factory' },
    { id: REVENUE, accountId: NORTHWIND, slug: 'revenue', name: 'Revenue' },
    { id: SUPPLY, accountId: CONTOSO, slug: 'supply', name: 'Contoso Supply' },
  ]);
  rileyPersonal = (await ensurePersonalProject(RILEY, NORTHWIND)).id;
  samPersonal = (await ensurePersonalProject(SAM, NORTHWIND)).id;

  await ask(FACTORY, 'Approve the Kestrel Capital term sheet', day(1));
  await ask(FACTORY, 'Choose a launch date for the Bellwater Hall series', day(3), RILEY);
  await ask(REVENUE, 'Sign off the Acme renewal discount', day(2));
  await ask(rileyPersonal, 'Accept the Larkfield Systems dinner invitation', day(4));
  await ask(samPersonal, 'Sam alone: reply to the Northwind board', day(1));
  await ask(SUPPLY, 'Contoso only: approve the freight quote', day(1));

  const [run] = await db.insert(actionRunSchema).values({ orgId: REVENUE, actionId: 'hubspot.update', input: { title: 'Move the Acme deal to closed won' }, status: 'pending', createdAt: day(5) }).returning({ id: actionRunSchema.id });
  await db.insert(reviewAssignmentSchema).values({ orgId: REVENUE, kind: 'action', runId: run!.id, assignedTo: RILEY });
});

afterEach(() => {
  delete process.env.VOCION_ENFORCE_WORKSPACE_ACCESS;
  delete process.env.NEXT_PUBLIC_APP_URL;
  vi.restoreAllMocks();
});

describe('listInboxForUser', () => {
  it('reads the person\'s own workspace and the shared ones they reach — never another person\'s, never another account\'s', async () => {
    const inbox = await listInboxForUser(RILEY);
    const ids = inbox.workspaces.map(w => w.id);

    expect(ids).toEqual([rileyPersonal, FACTORY, REVENUE]);
    expect(ids).not.toContain(samPersonal);
    expect(ids).not.toContain(SUPPLY);

    const titles = inbox.items.map(i => i.title);

    expect(titles).not.toContain('Sam alone: reply to the Northwind board');
    expect(titles).not.toContain('Contoso only: approve the freight quote');
    expect(inbox.total).toBe(5);
    expect(inbox.unavailable).toEqual([]);
  });

  it('leaves out a shared workspace the person holds no grant on when access is enforced', async () => {
    process.env.VOCION_ENFORCE_WORKSPACE_ACCESS = '1';
    await db.insert(projectMemberSchema).values({ projectId: FACTORY, userId: RILEY, role: 'member', source: 'direct' });

    const ids = (await listInboxForUser(RILEY)).workspaces.map(w => w.id);

    expect(ids).toEqual([rileyPersonal, FACTORY]);
  });

  it('tags each row with its workspace and links it there, naming the account', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.vocion.example';
    const inbox = await listInboxForUser(RILEY);
    const renewal = inbox.items.find(i => i.title === 'Sign off the Acme renewal discount')!;

    expect(renewal.workspace).toEqual({ id: REVENUE, slug: 'revenue', name: 'Revenue', kind: 'shared' });
    expect(renewal.href).toMatch(/^\/w\/revenue\/dashboard\/inbox\/\d+\?account=northwind$/);
    expect(renewal.link).toBe(`https://app.vocion.example${renewal.href}`);
    // Keys stay unique when two workspaces hold rows with the same id.
    expect(new Set(inbox.items.map(i => i.key)).size).toBe(inbox.items.length);
  });

  it('puts the person\'s own rows first — their workspace, assigned to them, raised by them — then the oldest', async () => {
    const inbox = await listInboxForUser(RILEY);

    // A proposal's title is written by its describer; it is told apart here by its action.
    expect(inbox.items.map(i => [i.actionId ?? i.title, i.yoursBecause])).toEqual([
      ['Choose a launch date for the Bellwater Hall series', 'raised'],
      ['Accept the Larkfield Systems dinner invitation', 'personal'],
      ['hubspot.update', 'assigned'],
      ['Approve the Kestrel Capital term sheet', null],
      ['Sign off the Acme renewal discount', null],
    ]);
    expect(inbox.yours).toBe(3);
    expect(inbox.workspaces.find(w => w.id === REVENUE)).toMatchObject({ count: 2, yours: 1, capped: false });
  });

  it('narrows to one workspace while every workspace keeps its count', async () => {
    const inbox = await listInboxForUser(RILEY, { workspaceId: FACTORY });

    expect(inbox.items.every(i => i.workspace.id === FACTORY)).toBe(true);
    expect(inbox.items).toHaveLength(2);
    expect(inbox.workspaces.map(w => w.count)).toEqual([1, 2, 2]);
  });

  it('caps the rows kept per workspace, the person\'s own kept first, and still counts them all', async () => {
    const inbox = await listInboxForUser(RILEY, { cap: 1 });
    const factory = inbox.items.filter(i => i.workspace.id === FACTORY);

    expect(factory.map(i => i.title)).toEqual(['Choose a launch date for the Bellwater Hall series']);
    expect(inbox.workspaces.find(w => w.id === FACTORY)).toMatchObject({ count: 2, capped: true });
    expect(inbox.total).toBe(5);
  });

  it('says which workspace could not be read, and why, instead of dropping it', async () => {
    const { needsYouItems } = await import('@/services/InboxService');
    const inbox = await listInboxForUser(RILEY, { read: async orgId => (orgId === REVENUE ? Promise.reject(new Error('statement timeout')) : needsYouItems(orgId)) });

    expect(inbox.unavailable).toEqual([{ workspace: expect.objectContaining({ id: REVENUE }), reason: 'statement timeout' }]);
    expect(inbox.items.some(i => i.workspace.id === REVENUE)).toBe(false);
  });

  it('runs a bounded number of queries: set by the workspaces, not by the rows', async () => {
    const client = (db as unknown as { $client: { query: (...a: unknown[]) => unknown } }).$client;
    const spy = vi.spyOn(client, 'query');

    await listInboxForUser(RILEY);
    const few = spy.mock.calls.length;

    for (let i = 0; i < 12; i++) {
      await ask(FACTORY, `Pick the Northwind supplier for lot ${i + 1}`, day(6));
    }
    spy.mockClear();
    await listInboxForUser(RILEY);
    const many = spy.mock.calls.length;

    // Three workspaces: two queries to find them (the switcher's list and the
    // accounts), then the open queue's ten per workspace — eight for the rows,
    // one for their clocks and one for the runs parked on a resume gate
    // (measured: 32).
    expect(few).toBeLessThanOrEqual(2 + 3 * 10);
    expect(many).toBe(few);
  });
});

describe('needsYouCountForUser', () => {
  it('counts what the list counts, per workspace', async () => {
    const count = await needsYouCountForUser(RILEY);

    expect(count).toMatchObject({ total: 5, yours: 3, unavailable: 0 });
    expect(count.workspaces.map(w => [w.id, w.count, w.yours])).toEqual([[rileyPersonal, 1, 1], [FACTORY, 2, 1], [REVENUE, 2, 1]]);
  });
});

describe('byYoursThenAge', () => {
  it('orders yours before the rest, then oldest first, then by key', () => {
    const rows = [
      { key: 'b', yours: false, at: day(1) },
      { key: 'c', yours: true, at: day(9) },
      { key: 'a', yours: false, at: day(1) },
      { key: 'd', yours: true, at: day(2) },
    ];

    expect(rows.sort(byYoursThenAge).map(r => r.key)).toEqual(['d', 'c', 'a', 'b']);
  });
});
