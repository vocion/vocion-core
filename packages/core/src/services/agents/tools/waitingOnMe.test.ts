/**
 * waiting_on_me reads the records, not the knowledge base.
 *
 * Regression for 2026-10-08: asked "what is waiting on me", a workspace agent
 * searched its documents for "open asks approvals waiting on <name>" and found
 * nothing, while the review queue held the answer. These pin the typed read:
 * the person's own decisions first, their follow-ups and their unread
 * notices, scoped to the workspace — or, in a personal workspace, to every
 * workspace they can reach.
 */
import type { RuntimeContext } from '../types';
import type { InboxItem } from '@/services/InboxService';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/InboxService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/InboxService')>()),
  needsYouItems: vi.fn(),
}));

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, askSchema, notificationSchema, projectMemberSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { needsYouItems } = await import('@/services/InboxService');
const { ensurePersonalProject } = await import('@/services/workspace/personalProject');
const { readWaitingOnMe, renderWaitingOnMe, waitingOnMeTools } = await import('./waitingOnMe');

const ACCOUNT = 'acct-wom-northwind';
const ALEX = 'usr-wom-alex';
const CASS = 'usr-wom-cass';
const REVENUE = 'proj-wom-revenue';
const DELIVERY = 'proj-wom-delivery';
const NOW = new Date('2026-10-08T15:00:00Z');

let alexHome: string;

function row(over: Partial<InboxItem> & Pick<InboxItem, 'key' | 'title'>): InboxItem {
  return { kind: 'approval', shape: 'single', agentSlug: null, teamSlug: null, risk: null, status: 'open', at: new Date('2026-10-06T12:00:00Z'), href: `/dashboard/inbox/${over.key}`, ...over } as InboxItem;
}

function ctxFor(orgId: string, kind: 'shared' | 'personal'): RuntimeContext {
  return {
    orgId,
    userId: ALEX,
    agentSlug: 'lead',
    workspaceKind: kind,
    timeZone: 'America/Los_Angeles',
    connectorSources: [],
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    citationSeq: { current: 0 },
    emit: () => {},
  } as RuntimeContext;
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Northwind', slug: 'northwind-wom' });
  await db.insert(userSchema).values([
    { id: ALEX, email: 'alex@northwind.example', name: 'Alex Rivera' },
    { id: CASS, email: 'cass@northwind.example', name: 'Cass Lund' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: ACCOUNT, userId: ALEX, role: 'member' },
    { accountId: ACCOUNT, userId: CASS, role: 'member' },
  ]);
  await db.insert(projectSchema).values([
    { id: REVENUE, accountId: ACCOUNT, slug: 'revenue-wom', name: 'Revenue Team' },
    { id: DELIVERY, accountId: ACCOUNT, slug: 'delivery-wom', name: 'Delivery Team' },
  ]);
  await db.insert(projectMemberSchema).values([
    { projectId: REVENUE, userId: ALEX, role: 'member' },
    { projectId: DELIVERY, userId: ALEX, role: 'member' },
  ]);
  alexHome = (await ensurePersonalProject(ALEX, ACCOUNT)).id;

  await db.insert(askSchema).values([
    // A follow-up Alex owes: his ask came back answered "other", with a note.
    { orgId: DELIVERY, kind: 'ruling', title: 'Ship the Contoso Supply cutover Friday?', status: 'approved', decision: 'other', decisionNote: 'Only after the data check passes', followUp: true, createdBy: ALEX, decidedAt: new Date('2026-10-07T18:00:00Z') },
    // Cass's follow-up is not Alex's.
    { orgId: DELIVERY, kind: 'ruling', title: 'Cass asked about Bellwater Hall', status: 'approved', decision: 'other', decisionNote: 'see thread', followUp: true, createdBy: CASS, decidedAt: new Date('2026-10-07T18:00:00Z') },
    // Too old to still be owed.
    { orgId: REVENUE, kind: 'ruling', title: 'An old follow-up', status: 'approved', decision: 'other', followUp: true, createdBy: ALEX, decidedAt: new Date('2026-08-01T18:00:00Z') },
  ]);
  await db.insert(notificationSchema).values([
    { orgId: REVENUE, userId: ALEX, kind: 'mention', title: 'Cass mentioned you on the Kestrel Capital renewal', link: '/w/revenue-wom/dashboard/chat/12', dedupeKey: 'm1' },
    { orgId: REVENUE, userId: ALEX, kind: 'mention', title: 'Already read', dedupeKey: 'm2', readAt: new Date('2026-10-07T00:00:00Z') },
    { orgId: REVENUE, userId: CASS, kind: 'mention', title: 'For Cass only', dedupeKey: 'm3' },
  ]);
});

beforeEach(() => {
  vi.mocked(needsYouItems).mockReset();
  vi.mocked(needsYouItems).mockImplementation(async (orgId: string) => {
    if (orgId === REVENUE) {
      return [
        row({ key: 'proposal:1', title: 'Send the Northwind renewal quote', kind: 'proposal', reviewId: 1, assignedTo: ALEX, at: new Date('2026-10-05T12:00:00Z') }),
        row({ key: 'ask:2', title: 'Approve the Acme discount', askId: 2, raisedBy: CASS }),
      ];
    }
    if (orgId === DELIVERY) {
      return [row({ key: 'ask:3', title: 'Approve the Contoso Supply change order', askId: 3, raisedBy: ALEX, at: new Date('2026-10-04T12:00:00Z') })];
    }
    return [];
  });
});

afterAll(async () => {
  await db.delete(notificationSchema);
  await db.delete(askSchema);
});

describe('readWaitingOnMe', () => {
  it('in a shared workspace: that workspace only, the person\'s own decisions picked out', async () => {
    const w = await readWaitingOnMe({ userId: ALEX, accountId: ACCOUNT, orgId: REVENUE, across: false, now: NOW });

    expect(w.decisions.map(d => d.title)).toEqual(['Send the Northwind renewal quote', 'Approve the Acme discount']);
    expect(w.decisions[0]).toMatchObject({ yours: true, yoursBecause: 'assigned' });
    expect(w.decisions[1]!.yours).toBe(false);
    // Only this workspace's queue was read.
    expect(vi.mocked(needsYouItems).mock.calls.map(c => c[0])).toEqual([REVENUE]);
    expect(w.followUps).toEqual([]);
    expect(w.mentions.map(m => m.title)).toEqual(['Cass mentioned you on the Kestrel Capital renewal']);
  });

  it('in a personal workspace: every workspace the person reaches, in one read', async () => {
    const w = await readWaitingOnMe({ userId: ALEX, accountId: ACCOUNT, orgId: alexHome, across: true, now: NOW });

    expect(w.scope).toBe('all');
    // Yours first, oldest first, wherever it lives.
    expect(w.decisions.filter(d => d.yours).map(d => d.title)).toEqual(['Approve the Contoso Supply change order', 'Send the Northwind renewal quote']);
    expect(w.followUps.map(f => f.title)).toEqual(['Ship the Contoso Supply cutover Friday?']);
    expect(w.followUps[0]!.href).toContain('/w/delivery-wom/');
    expect(w.mentions).toHaveLength(1);
  });
});

describe('waiting_on_me', () => {
  it('is there whenever a person is in the turn, and never without one', () => {
    expect(waitingOnMeTools(ctxFor(REVENUE, 'shared')).map(t => t.name)).toEqual(['waiting_on_me']);
    expect(waitingOnMeTools({ ...ctxFor(REVENUE, 'shared'), userId: undefined })).toEqual([]);
  });

  it('answers with the typed list, in the order to take it, and tells the model not to search', async () => {
    const [t] = waitingOnMeTools(ctxFor(alexHome, 'personal'));
    const out = String(await t!.invoke({}));

    expect(out).toMatch(/do not search/);
    expect(out.indexOf('Approve the Contoso Supply change order')).toBeLessThan(out.indexOf('Send the Northwind renewal quote'));
    expect(out).toContain('FOLLOW-UPS YOU OWE (1)');
    expect(out).toContain('Only after the data check passes');
    expect(out).toContain('Cass mentioned you');
    expect(out).not.toContain('For Cass only');
  });

  it('lists the email replies the person owes from their own mailbox, with where to find the rest', () => {
    const place = { id: REVENUE, slug: 'revenue', name: 'Revenue', accountSlug: 'northwind-wom' };
    const row = {
      set: 'mail.thread',
      noun: 'email thread',
      documentId: 7,
      key: 'gmail-thread-state:t-contoso',
      title: 'Reply owed: Pricing for the managed service — Jamie Smith',
      link: 'https://mail.google.com/mail/u/alex%40northwind.example/#all/t-contoso',
      at: new Date('2026-10-07T10:00:00Z'),
      facets: { counterpart: 'Jamie Smith <jamie@contoso.example>', ask: 'Wants pricing for 40 seats' },
      sourceSlug: 'gmail',
      workspace: place,
    };
    const out = renderWaitingOnMe({ scope: 'workspace', decisions: [], totalOpen: 0, followUps: [], mentions: [], views: [{ slug: 'owed-replies', name: 'Email replies I owe', description: 'the other side is waiting on my answer', rows: [row], total: 12 }], unavailable: [] });

    expect(out).toContain('EMAIL REPLIES YOU OWE (12)');
    expect(out).toContain('[Reply owed: Pricing for the managed service — Jamie Smith](https://mail.google.com/');
    expect(out).toContain('Wants pricing for 40 seats');
    expect(out).toContain('and 11 more: query_state with view "owed-replies" lists them all');
  });

  it('says nothing is there rather than inventing it', () => {
    const out = renderWaitingOnMe({ scope: 'workspace', decisions: [], totalOpen: 0, followUps: [], mentions: [], views: [], unavailable: [] });

    expect(out).toContain('DECISIONS ON YOU: none.');
    expect(out).toContain('FOLLOW-UPS YOU OWE: none.');
    expect(out).toContain('UNREAD MENTIONS AND NOTICES: none.');
  });

  it('from a Personal across Orgs, says each item\'s Org, and an opted-out Org only as a count with a link', () => {
    const out = renderWaitingOnMe({
      scope: 'all',
      decisions: [
        { key: 'a', kind: 'approval', title: 'Approve the Acme freight quote', at: new Date('2026-10-07T10:00:00Z'), href: '/w/supply/dashboard/inbox/ask/1', link: 'https://app.example/w/supply/dashboard/inbox/ask/1', yours: true, yoursBecause: 'raised', workspace: { id: 'p1', slug: 'supply', name: 'Supply Desk', kind: 'shared', accountName: 'Contoso Supply' } },
        { key: 'b', kind: 'approval', title: 'Approve the Bellwater launch', at: new Date('2026-10-06T10:00:00Z'), href: '/w/factory/dashboard/inbox/ask/2', link: 'https://app.example/w/factory/dashboard/inbox/ask/2', yours: true, yoursBecause: 'raised', workspace: { id: 'p2', slug: 'factory', name: 'Factory', kind: 'shared', accountName: 'Northwind' } },
      ] as never,
      totalOpen: 2,
      followUps: [],
      mentions: [],
      views: [],
      unavailable: [],
      withheld: [{ accountName: 'Kestrel Capital', accountSlug: 'kestrel', workspace: { name: 'Deal Desk', slug: 'deals' }, count: 3, yours: 1, link: 'https://app.example/w/deals/dashboard/inbox?org=kestrel' }],
    });

    expect(out).toContain('— Supply Desk · Contoso Supply');
    expect(out).toContain('— Factory · Northwind');
    expect(out).toContain('Kestrel Capital › Deal Desk: 3 waiting (1 on you) · [open there](https://app.example/w/deals/dashboard/inbox?org=kestrel)');
  });

  it('refuses to read for someone who is not in the workspace', async () => {
    const [t] = waitingOnMeTools({ ...ctxFor('proj-wom-nowhere', 'shared') });
    const out = String(await t!.invoke({}));

    expect(out).toMatch(/Could not confirm who is asking/);
  });
});
