import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema } = await import('@/models/Schema');
const { closeMergeCardsOnMerge } = await import('./mergeCards');

const ORG = 'org_merge_cards';
const PR = 'https://github.com/acme/app/pull/12';

async function card(status: string, input: Record<string, unknown>, orgId = ORG) {
  const [row] = await db.insert(actionRunSchema).values({ orgId, actionId: 'git.merge', status, input }).returning({ id: actionRunSchema.id });
  return row!.id;
}

beforeEach(async () => {
  await db.delete(actionRunSchema);
});

describe('closeMergeCardsOnMerge', () => {
  it('closes the open merge card for the merged PR as done by GitHub, with the merge commit', async () => {
    const pending = await card('pending', { externalRef: { system: 'github', id: 'acme/app/pull/12', url: PR } });
    const released = await card('awaiting_execution', { evidence: [PR] });

    const closed = await closeMergeCardsOnMerge(ORG, { url: PR, mergeSha: 'abcdef1234567890', mergedAt: '2026-09-26T18:00:00Z' });

    expect(closed.sort()).toEqual([pending, released].sort());

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, pending));

    expect(row).toMatchObject({ status: 'done', decidedBy: 'github' });
    expect(row!.result).toMatchObject({ executed: { by: 'github', note: 'Merged on GitHub at abcdef123456.', resultUrl: PR } });
  });

  it('leaves other PRs, other orgs and decided cards alone', async () => {
    const other = await card('pending', { evidence: ['https://github.com/acme/app/pull/13'] });
    const elsewhere = await card('pending', { evidence: [PR] }, 'org_other');
    const rejected = await card('rejected', { evidence: [PR] });

    expect(await closeMergeCardsOnMerge(ORG, { url: PR, mergeSha: 'abc' })).toEqual([]);

    const rows = await db.select({ id: actionRunSchema.id, status: actionRunSchema.status }).from(actionRunSchema);

    expect(rows.find(r => r.id === other)?.status).toBe('pending');
    expect(rows.find(r => r.id === elsewhere)?.status).toBe('pending');
    expect(rows.find(r => r.id === rejected)?.status).toBe('rejected');
  });
});
