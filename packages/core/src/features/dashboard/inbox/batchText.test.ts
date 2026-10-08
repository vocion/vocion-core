import type { RecommendationBatch } from '@/services/needsYou/batches';
import { describe, expect, it } from 'vitest';
import { batchMakeup, batchReceipt } from './batchText';

const BATCH: RecommendationBatch = {
  key: 'approve',
  label: 'Approve',
  count: 4,
  items: [
    { ref: 'ask:1', kind: 'approval', title: 'Renew Northwind?', href: '/dashboard/inbox/1' },
    { ref: 'ask:2', kind: 'approval', title: 'Publish the Contoso case study?', href: '/dashboard/inbox/2' },
    { ref: 'ask:3', kind: 'approval', title: 'Add Kestrel Capital to the list?', href: '/dashboard/inbox/3' },
    { ref: 'proposal:9', kind: 'proposal', title: 'Update the Acme deal stage', href: '/dashboard/inbox/proposal-9' },
  ],
};

describe('batchMakeup', () => {
  it('says what a batch is made of, most first', () => {
    expect(batchMakeup(BATCH)).toBe('3 approvals · 1 recommendation');
  });
});

describe('batchReceipt', () => {
  it('names how many were accepted, and that the agents learn from it', () => {
    expect(batchReceipt('Approve', { accepted: 4, skipped: 0, failed: 0, results: BATCH.items.map(i => ({ ref: i.ref, title: i.title, outcome: 'accepted' })) })).toEqual({
      title: 'Approve · 4 decisions accepted',
      description: 'Each was decided as recommended; the agents learn from it.',
      ok: true,
    });
  });

  it('says what was skipped or failed, item by item, and is an error when anything failed', () => {
    const r = batchReceipt('Approve', {
      accepted: 2,
      skipped: 1,
      failed: 1,
      results: [
        { ref: 'ask:1', title: 'Renew Northwind?', outcome: 'skipped', reason: 'already approved' },
        { ref: 'proposal:9', title: 'Update the Acme deal stage', outcome: 'failed', reason: 'HubSpot answered 400' },
        { ref: 'ask:2', title: 'b', outcome: 'accepted' },
        { ref: 'ask:3', title: 'c', outcome: 'accepted' },
      ],
    });

    expect(r.ok).toBe(false);
    expect(r.description).toBe('Skipped: Renew Northwind? — already approved · Failed: Update the Acme deal stage — HubSpot answered 400');
  });

  it('says plainly when nothing was accepted', () => {
    expect(batchReceipt('Decline', { accepted: 0, skipped: 1, failed: 0, results: [{ ref: 'ask:1', title: 'x', outcome: 'skipped', reason: 'already done' }] }).title).toBe('Nothing accepted under “Decline”');
  });
});
