/**
 * Every core view runs, over one fictional workspace holding each kind of
 * thing it reads — mail, meetings, deals, issues, pull requests, Slack,
 * invoices, decisions, connections — and returns exactly what it promises.
 * One shape across all of them: the same query, the same row.
 *
 * Documents are written as their connectors write them (the metadata keys are
 * the connectors' own), so a view that drifts from a connector fails here.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/inbox/acrossWorkspaces', () => ({
  listInboxForUser: vi.fn(async () => ({
    items: [
      { key: 'approval:41', kind: 'approval', title: 'Send the Northwind renewal quote', link: '/w/revenue/dashboard/inbox/approval/41', at: new Date('2026-10-08T09:00:00Z'), risk: 'low', yours: true, yoursBecause: 'assigned', workspace: { id: 'org-views-core', slug: 'revenue', name: 'Revenue' } },
      { key: 'ask:7', kind: 'ask', title: 'Pick a venue for the offsite', link: '/w/revenue/dashboard/inbox/ask/7', at: new Date('2026-10-07T09:00:00Z'), risk: null, yours: false, yoursBecause: null, workspace: { id: 'org-views-core', slug: 'revenue', name: 'Revenue' } },
    ],
    workspaces: [],
    total: 2,
    unavailable: [],
  })),
}));

const { db } = await import('@/libs/DB');
const { knowledgeDocumentSchema, knowledgeSourceSchema, sourceSyncCheckpointSchema, stateViewSchema } = await import('@/models/Schema');
const { runStateQuery, checkQuery } = await import('./queryState');
const { coreViews, resetCoreViewSeed, viewsFor } = await import('./views');
const { handlesOf } = await import('@/libs/retrieval/facets');

const ORG = 'org-views-core';
const NOW = new Date();
const DAY = 86_400_000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const ME = handlesOf({ email: 'alex@northwind.example', name: 'Alex Rivera' });

type Doc = { key: string; source: string; title: string; metadata: Record<string, unknown>; modified?: Date };

const SOURCES: Record<string, string> = { 'gmail': 'gmail', 'google-calendar': 'google-calendar', 'hubspot': 'hubspot', 'jira': 'jira', 'github': 'github', 'slack': 'slack', 'quickbooks': 'quickbooks' };

const DOCS: Doc[] = [
  // Mail: one owed, one waiting a week, one waiting a day, one in someone else's mailbox.
  { key: 'mail-owed', source: 'gmail', title: 'Reply owed: Pricing — Jamie Smith', metadata: { kind: 'mail-thread-state', threadId: 't1', facets: { reply_state: 'needs_my_reply', mailbox: 'alex@northwind.example', last_inbound_at: at(-2 * DAY).toISOString(), counterpart: 'Jamie Smith <jamie@contoso.example>' } } },
  { key: 'mail-waiting-week', source: 'gmail', title: 'Waiting on them: Proposal — Rae', metadata: { kind: 'mail-thread-state', threadId: 't2', facets: { reply_state: 'waiting_on_them', mailbox: 'alex@northwind.example', last_outbound_at: at(-7 * DAY).toISOString() } } },
  { key: 'mail-waiting-day', source: 'gmail', title: 'Waiting on them: Intro — Dana', metadata: { kind: 'mail-thread-state', threadId: 't3', facets: { reply_state: 'waiting_on_them', mailbox: 'alex@northwind.example', last_outbound_at: at(-1 * DAY).toISOString() } } },
  { key: 'mail-not-mine', source: 'gmail', title: 'Reply owed: Invoice — Ops', metadata: { kind: 'mail-thread-state', threadId: 't4', facets: { reply_state: 'needs_my_reply', mailbox: 'cass@northwind.example', last_inbound_at: at(-1 * DAY).toISOString() } } },
  // Calendar: external in 3h, internal in 2h, external tomorrow+2.
  { key: 'cal-external-soon', source: 'google-calendar', title: 'Acme intro', metadata: { kind: 'calendar-event', start: at(3 * 3_600_000).toISOString(), organizer: 'alex@northwind.example', attendees: ['alex@northwind.example', 'pat@acme.example'], facets: { external_attendees: 1 } } },
  { key: 'cal-internal-soon', source: 'google-calendar', title: 'Team sync', metadata: { kind: 'calendar-event', start: at(2 * 3_600_000).toISOString(), organizer: 'alex@northwind.example', attendees: ['cass@northwind.example'], facets: { external_attendees: 0 } } },
  { key: 'cal-external-later', source: 'google-calendar', title: 'Kestrel review', metadata: { kind: 'calendar-event', start: at(3 * DAY).toISOString(), organizer: 'alex@northwind.example', attendees: ['dana@kestrel.example'], facets: { external_attendees: 1 } } },
  // Deals: stale open, stale closed, fresh open.
  { key: 'deal-stale', source: 'hubspot', title: 'Contoso managed service', metadata: { objectType: 'deals', dealStage: 'presentationscheduled', amount: 48000 }, modified: at(-20 * DAY) },
  { key: 'deal-closed', source: 'hubspot', title: 'Acme pilot', metadata: { objectType: 'deals', dealStage: 'closedwon', amount: 12000 }, modified: at(-40 * DAY) },
  { key: 'deal-fresh', source: 'hubspot', title: 'Northwind renewal', metadata: { objectType: 'deals', dealStage: 'contractsent', amount: 90000 }, modified: at(-2 * DAY) },
  // Issues: mine overdue, mine done, someone else's overdue.
  { key: 'issue-overdue', source: 'jira', title: '[OPS-12] Rotate the API keys', metadata: { type: 'issue', assignee: 'alex@northwind.example', completed: false, due: at(-3 * DAY).toISOString().slice(0, 10) } },
  { key: 'issue-done', source: 'jira', title: '[OPS-9] Renew the cert', metadata: { type: 'issue', assignee: 'alex@northwind.example', completed: true, due: at(-5 * DAY).toISOString().slice(0, 10) } },
  { key: 'issue-other', source: 'jira', title: '[OPS-14] Patch the box', metadata: { type: 'issue', assignee: 'cass@northwind.example', completed: false, due: at(-1 * DAY).toISOString().slice(0, 10) } },
  // Pull requests: review requested of me (login = my address's local part), of someone else, closed.
  { key: 'pr-mine', source: 'github', title: 'northwind/app#88', metadata: { kind: 'pull_request', state: 'open', requestedReviewers: ['alex'], draft: false } },
  { key: 'pr-other', source: 'github', title: 'northwind/app#89', metadata: { kind: 'pull_request', state: 'open', requestedReviewers: ['cass'], draft: false } },
  { key: 'pr-closed', source: 'github', title: 'northwind/app#80', metadata: { kind: 'pull_request', state: 'closed', requestedReviewers: ['alex'], draft: false } },
  // Slack: a mention by member id (needs the person's own copy), and no mention.
  { key: 'slack-mention', source: 'slack', title: '#deals · 1', metadata: { kind: 'slack-message', channelName: 'deals', user: 'U0CASS', mentions: ['U0ALEX'] }, modified: at(-1 * DAY) },
  { key: 'slack-plain', source: 'slack', title: '#deals · 2', metadata: { kind: 'slack-message', channelName: 'deals', user: 'U0CASS', mentions: [] }, modified: at(-1 * DAY) },
  // Invoices: overdue unpaid, overdue paid, not yet due.
  { key: 'inv-overdue', source: 'quickbooks', title: 'Invoice 1042 to Contoso Supply', metadata: { objectType: 'invoice', customer: 'Contoso Supply', dueDate: at(-10 * DAY).toISOString().slice(0, 10), balance: 4800, status: 'overdue' } },
  { key: 'inv-paid', source: 'quickbooks', title: 'Invoice 1040 to Acme', metadata: { objectType: 'invoice', customer: 'Acme', dueDate: at(-12 * DAY).toISOString().slice(0, 10), balance: 0, status: 'paid' } },
  { key: 'inv-future', source: 'quickbooks', title: 'Invoice 1050 to Northwind', metadata: { objectType: 'invoice', customer: 'Northwind', dueDate: at(10 * DAY).toISOString().slice(0, 10), balance: 9000, status: 'open' } },
];

beforeAll(async () => {
  resetCoreViewSeed();
  const ids: Record<string, number> = {};
  for (const [slug, connector] of Object.entries(SOURCES)) {
    const [row] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug, kind: 'plugin', configJson: { _connector: connector } }).returning({ id: knowledgeSourceSchema.id });
    ids[slug] = row!.id;
  }
  for (const d of DOCS) {
    await db.insert(knowledgeDocumentSchema).values({ orgId: ORG, sourceId: ids[d.source]!, externalId: d.key, title: d.title, metadata: d.metadata, contentHash: d.key, lastModifiedAt: d.modified ?? NOW });
  }
  // A connection whose last sync failed.
  await db.insert(sourceSyncCheckpointSchema).values({ sourceId: ids.quickbooks!, orgId: ORG, status: 'failed', error: 'QuickBooks refused the token (401)', completedAt: at(-3_600_000) });
});

afterAll(async () => {
  await db.delete(sourceSyncCheckpointSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
  await db.delete(stateViewSchema);
});

const EXPECTED: Record<string, string[]> = {
  'owed-replies': ['mail-owed'],
  'awaiting-their-reply': ['mail-waiting-week'],
  'meetings-needing-prep': ['cal-external-soon'],
  'stale-deals': ['deal-stale'],
  'my-overdue-tasks': ['issue-overdue'],
  'prs-awaiting-my-review': ['pr-mine'],
  'slack-mentions': [],
  'approvals-waiting-on-me': ['decision:approval:41'],
  'overdue-invoices': ['inv-overdue'],
  'broken-connections': [`connection:${ORG}:quickbooks`],
};

describe('core views', () => {
  it('ships every view the platform promises, each a query that can run', () => {
    expect(coreViews().map(v => v.slug).sort()).toEqual(Object.keys(EXPECTED).sort());

    for (const v of coreViews()) {
      expect(checkQuery(v.query), v.slug).toEqual([]);
    }
  });

  it.each(Object.entries(EXPECTED))('%s returns exactly what it promises', async (slug, keys) => {
    const view = (await viewsFor({ orgId: ORG, userId: 'usr-views-alex' })).find(v => v.slug === slug)!;
    const read = await runStateQuery(view.query, { orgIds: [ORG], userId: 'usr-views-alex', me: ME, now: NOW });

    expect(read.rows.map(r => r.key)).toEqual(keys);

    for (const r of read.rows) {
      expect(r).toMatchObject({ set: expect.any(String), noun: expect.any(String), title: expect.any(String) });
    }
  });

  it('Slack mentions match once the person\'s own copy carries their member id', async () => {
    const read = await runStateQuery({ sets: ['chat.message'], filter: { mentions: ['U0ALEX'], updated_at: { since: '-7d' } } }, { orgIds: [ORG], me: ME, now: NOW });

    expect(read.rows.map(r => r.key)).toEqual(['slack-mention']);
  });

  it('says which kinds nothing here carries, rather than answering "none"', async () => {
    const read = await runStateQuery({ sets: ['crm.deal'] }, { orgIds: ['org-views-empty'], me: ME, now: NOW });

    expect(read.missing).toEqual(['crm.deal']);
  });
});
