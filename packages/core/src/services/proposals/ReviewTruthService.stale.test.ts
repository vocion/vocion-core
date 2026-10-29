/**
 * The review sweep's "overtaken" pass: pending runs whose action declares
 * `stillHolds` are checked, a bounded number per pass, the longest unchecked
 * first. Stale ones close with what changed, unless the finding keeps them
 * open (a reply whose thread moved), which stay pending, marked.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/libs/DB');
const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { actionRunSchema } = await import('@/models/Schema');
const { registerAction } = await import('@/libs/actions/registry');
const svc = await import('./ReviewTruthService');

const ORG = 'org_review_stale';
const NOW = new Date('2026-10-29T12:00:00Z');
const DAY = 86_400_000;

/** What each run's check answers, by its input's `key`. */
const verdicts = new Map<string, { line: string; keepOpen?: boolean; href?: string } | null | 'throw'>();
const checked: string[] = [];
registerAction({
  id: 'test.sweep-stale',
  name: 'Sweep stale',
  description: 'test',
  inputSchema: z.object({ key: z.string() }),
  grant: 'test_write',
  external: true,
  stillHolds: async (_ctx, input) => {
    checked.push(input.key);
    const v = verdicts.get(input.key) ?? null;
    if (v === 'throw') {
      throw new Error('down');
    }
    return v;
  },
  execute: async () => ({ ok: true }),
});
registerAction({
  id: 'test.sweep-plain',
  name: 'Sweep plain',
  description: 'test',
  inputSchema: z.object({ key: z.string() }),
  grant: 'test_write',
  external: true,
  execute: async () => ({ ok: true }),
});

async function run(key: string, opts: { actionId?: string; createdAt?: Date; checkedAt?: Date; regeneratingSince?: Date } = {}) {
  const [row] = await db.insert(actionRunSchema).values({
    orgId: ORG,
    actionId: opts.actionId ?? 'test.sweep-stale',
    input: { key },
    status: 'pending',
    invokedBy: 'agent:inbox-triage',
    createdAt: opts.createdAt ?? new Date(NOW.getTime() - DAY),
    proposal: opts.checkedAt ? { staleCheckedAt: opts.checkedAt.toISOString() } : null,
    regeneratingSince: opts.regeneratingSince ?? null,
  } as never).returning({ id: actionRunSchema.id });
  return row!.id;
}

const rowOf = async (id: number) => (await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, id)))[0]!;
const sweep = (staleChecks = 20) => svc.sweepReviewQueue({ now: NOW, orgId: ORG, stillWaitingAfterMs: 30 * DAY, staleChecks });

beforeEach(async () => {
  await db.delete(actionRunSchema);
  verdicts.clear();
  checked.length = 0;
});

afterAll(async () => {
  await db.delete(actionRunSchema);
});

describe('the sweep closes what was overtaken', () => {
  it('closes a stale run with what changed, through the close-with-reason path', async () => {
    const id = await run('deal');
    verdicts.set('deal', { line: 'dealstage changed from presentationscheduled to closedwon since this was proposed', href: 'https://crm.example.test/deal/4812' });
    const out = await sweep();

    expect(out.closed).toEqual([{ kind: 'run', id, orgId: ORG, why: 'what it was proposed on changed: dealstage changed from presentationscheduled to closedwon since this was proposed', link: 'https://crm.example.test/deal/4812' }]);

    const row = await rowOf(id);

    expect(row).toMatchObject({ status: 'closed', decidedBy: svc.REVIEW_SWEEPER });
    expect(row.result).toMatchObject({ closed: { rule: 'stale', link: 'https://crm.example.test/deal/4812' } });
    expect(row.error).toContain('closed: what it was proposed on changed');
  });

  it('a finding that keeps it open is marked, not closed: the run stays pending with the line', async () => {
    const id = await run('reply');
    verdicts.set('reply', { line: 'Dana Reyes wrote again on Oct 30', keepOpen: true });
    const out = await sweep();

    expect(out.closed).toEqual([]);
    expect(out.markedStale).toEqual([{ id, orgId: ORG, line: 'Dana Reyes wrote again on Oct 30' }]);

    const row = await rowOf(id);

    expect(row.status).toBe('pending');
    expect((row.proposal as { stale?: { line: string } }).stale?.line).toBe('Dana Reyes wrote again on Oct 30');
  });

  it('leaves a run that still holds alone, but records when it was checked', async () => {
    const id = await run('ok');
    await sweep();
    const row = await rowOf(id);

    expect(row.status).toBe('pending');
    expect((row.proposal as { staleCheckedAt?: string }).staleCheckedAt).toBe(NOW.toISOString());
  });

  it('fails open: a check that throws leaves the run pending', async () => {
    const id = await run('down');
    verdicts.set('down', 'throw');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await sweep();
    warn.mockRestore();

    expect(out.closed).toEqual([]);
    expect((await rowOf(id)).status).toBe('pending');
  });
});

describe('bounded, oldest check first', () => {
  it('checks at most the bound, never-checked first, then the longest since a check', async () => {
    await run('recent-check', { checkedAt: new Date(NOW.getTime() - 2 * 3_600_000) });
    await run('old-check', { checkedAt: new Date(NOW.getTime() - 3 * DAY) });
    await run('never-new', { createdAt: new Date(NOW.getTime() - DAY) });
    await run('never-old', { createdAt: new Date(NOW.getTime() - 5 * DAY) });
    await sweep(3);

    expect(checked).toEqual(['never-old', 'never-new', 'old-check']);
  });

  it('skips a run checked within the read cache, one being redrafted, and an action with no check', async () => {
    await run('just-checked', { checkedAt: new Date(NOW.getTime() - 60_000) });
    await run('redrafting', { regeneratingSince: new Date(NOW.getTime() - 60_000) });
    await run('plain', { actionId: 'test.sweep-plain' });
    await sweep();

    expect(checked).toEqual([]);
  });

  it('a bound of zero checks nothing', async () => {
    await run('deal');
    await sweep(0);

    expect(checked).toEqual([]);
  });
});
