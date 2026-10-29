import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/records/recordLabel', () => ({ resolveRecordLabels: vi.fn(async () => new Map([['hubspot:deals:7781', 'Northwind renewal']])) }));

const { receiptFor } = await import('./receiptFor');

describe('a Done line read off its run', () => {
  it('names the record from the mirror and each change old → new from the values the run kept', async () => {
    const r = await receiptFor('org-northwind', { runId: 5590, actionId: 'hubspot.update', label: 'Update HubSpot record', undoable: true, href: '/dashboard/records/x' }, {
      actionId: 'hubspot.update',
      input: { objectType: 'deals', objectId: '7781', properties: { dealstage: 'contractsent' } },
      result: { objectType: 'deals', objectId: '7781', updated: ['dealstage'], previous: { dealstage: 'presentationscheduled' } },
    });

    expect(r.record).toEqual({ label: 'Northwind renewal', href: '/dashboard/records/x' });
    expect(r.changes).toEqual([{ field: 'Deal stage', from: 'presentationscheduled', to: 'contractsent' }]);
  });

  it('keeps what the action says it did', async () => {
    const r = await receiptFor('org-northwind', { runId: 7, actionId: 'site.publish_page', label: 'Publish', undoable: true }, { actionId: 'site.publish_page', input: { pageRecordId: 20 }, result: { receipt: { text: 'Pull request opened', href: 'https://github.com/example-org/northwind-site/pull/12', linkLabel: 'example-org/northwind-site#12' } } });

    expect(r.outcome).toEqual({ text: 'Pull request opened', href: 'https://github.com/example-org/northwind-site/pull/12', linkLabel: 'example-org/northwind-site#12' });
  });
});
