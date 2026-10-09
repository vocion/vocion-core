/**
 * The thread-state backfill: plans from ids alone (no reads, no model), files
 * the state of every thread in the window, and a second run costs nothing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

process.env.VOCION_LLM_MODE = 'replay';

vi.mock('@/libs/DB');
vi.mock('@/services/SourceCredentialService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/SourceCredentialService')>()),
  getCredentialsForConnector: vi.fn(async () => ({ token: 'fixture-token' })),
}));

const { db } = await import('@/libs/DB');
const { knowledgeChunkSchema, knowledgeDocumentSchema, knowledgeSourceSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { planThreadStateBackfill, runThreadStateBackfill } = await import('./threadLabeller');
const { FIXTURE_VERDICTS, fixtureThreads, gmailApiStub } = await import('./testing/fixtureInbox');

const ORG = 'org-backfill';
const threads = fixtureThreads(Date.now());
const realFetch = globalThis.fetch;
const calls: string[] = [];
const model = async (_s: string, user: string) => {
  const subject = /^Subject: (.*)$/m.exec(user)?.[1] ?? '';
  calls.push(subject);
  return { text: JSON.stringify(FIXTURE_VERDICTS[subject] ?? { state: 'fyi', category: 'other', ask: '' }), model: 'claude-haiku-4-5-20251001' };
};
let sourceId: number;

const SAME_ORG_WS = 'org-backfill-second';
const OTHER_ORG_WS = 'org-backfill-elsewhere';

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values([{ id: 'acct-backfill', name: 'Northwind', slug: 'northwind-backfill' }, { id: 'acct-backfill-other', name: 'Kestrel Capital', slug: 'kestrel-backfill' }]);
  await db.insert(projectSchema).values([
    { id: ORG, accountId: 'acct-backfill', slug: 'executive', name: 'Executive' },
    { id: SAME_ORG_WS, accountId: 'acct-backfill', slug: 'revenue', name: 'Revenue Team' },
    { id: OTHER_ORG_WS, accountId: 'acct-backfill-other', slug: 'revenue', name: 'Revenue' },
  ]);
  globalThis.fetch = vi.fn(async (input: string | URL | Request) => gmailApiStub(threads, typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)) as typeof fetch;
  const [row] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'gmail', kind: 'plugin', configJson: { _connector: 'gmail' } }).returning({ id: knowledgeSourceSchema.id });
  sourceId = row!.id;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await db.delete(knowledgeChunkSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
});

describe('thread-state backfill', () => {
  it('plans the window from ids alone and prices the worst case', async () => {
    const plan = await planThreadStateBackfill({ orgId: ORG, sourceId, windowDays: 30 });

    // Seven threads have mail in the last 30 days; the 45-day-old one is out.
    expect(plan?.threadIds.sort()).toEqual(['t-acme', 't-cobalt', 't-contoso', 't-kestrel', 't-meridian', 't-northwind', 't-tideline']);
    expect(plan).toMatchObject({ alreadyLabelled: 0, maxLabels: 7, maxCents: 0.56, mailbox: 'owner@metacto.example' });
    expect(calls).toEqual([]);
  });

  it('files every thread\'s state, labelling only what the headers cannot settle, and a re-run costs nothing', async () => {
    const plan = (await planThreadStateBackfill({ orgId: ORG, sourceId, windowDays: 30 }))!;
    const lines: string[] = [];
    const first = await runThreadStateBackfill(plan, { sleep: async () => {}, log: l => lines.push(l), model });

    expect(first).toMatchObject({ threads: 7, filed: 7, byRule: 2, labelled: 5, failed: 0 });
    expect(lines.at(-1)).toContain('7 filed');

    const states = await db.select({ externalId: knowledgeDocumentSchema.externalId }).from(knowledgeDocumentSchema);

    expect(states.filter(s => s.externalId.startsWith('gmail-thread-state:'))).toHaveLength(7);

    const again = (await planThreadStateBackfill({ orgId: ORG, sourceId, windowDays: 30 }))!;

    expect(again.alreadyLabelled).toBe(5);

    const before = calls.length;
    const second = await runThreadStateBackfill(again, { sleep: async () => {}, model });

    expect(second).toMatchObject({ labelled: 0, reused: 5, byRule: 2 });
    expect(calls.length).toBe(before);
  });

  it('the same mailbox in another workspace of the Org reuses the labels — and another Org does not', async () => {
    const [second] = await db.insert(knowledgeSourceSchema).values({ orgId: SAME_ORG_WS, slug: 'gmail', kind: 'plugin', configJson: { _connector: 'gmail' } }).returning({ id: knowledgeSourceSchema.id });
    const plan = (await planThreadStateBackfill({ orgId: SAME_ORG_WS, sourceId: second!.id, windowDays: 30 }))!;

    expect(plan.alreadyLabelled).toBe(5);

    const before = calls.length;
    const run = await runThreadStateBackfill(plan, { sleep: async () => {}, model });

    expect(run).toMatchObject({ filed: 7, labelled: 0, reused: 5 });
    expect(calls.length).toBe(before);

    const [elsewhere] = await db.insert(knowledgeSourceSchema).values({ orgId: OTHER_ORG_WS, slug: 'gmail', kind: 'plugin', configJson: { _connector: 'gmail' } }).returning({ id: knowledgeSourceSchema.id });

    expect((await planThreadStateBackfill({ orgId: OTHER_ORG_WS, sourceId: elsewhere!.id, windowDays: 30 }))!.alreadyLabelled).toBe(0);
  });
});
