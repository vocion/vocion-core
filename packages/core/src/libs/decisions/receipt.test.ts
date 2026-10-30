import { describe, expect, it } from 'vitest';
import { failureReason, outcomeOf, readDoneReceipt, receiptText } from './receipt';

describe('the Done line (a HubSpot deal update, 2026-10-28)', () => {
  it('reads "Done. <record> updated: <field> old → new", the record its link', () => {
    const r = { runId: 5590, actionId: 'hubspot.update', label: 'Update HubSpot record', undoable: true, record: { label: 'Northwind renewal', href: '/dashboard/records/hubspot:deals:7781' }, changes: [{ field: 'Deal stage', from: 'Proposal', to: 'Contract sent' }, { field: 'Amount', from: '$40,000', to: '$48,000' }] };

    expect(receiptText(r)).toBe('Done. Northwind renewal updated: Deal stage: Proposal → Contract sent, Amount: $40,000 → $48,000');
    expect(receiptText(r)).not.toMatch(/ACT-|Completed|without waiting/);
  });

  it('says what an action says it did, with its link', () => {
    const outcome = outcomeOf({ receipt: { text: 'Pull request opened', href: 'https://github.com/example-org/northwind-site/pull/12', linkLabel: 'example-org/northwind-site#12' } });

    expect(receiptText({ runId: 1, actionId: 'site.publish_page', label: 'Publish', undoable: true, outcome })).toBe('Done. Pull request opened: example-org/northwind-site#12');
    expect(outcomeOf({ receipt: { text: 'x', href: 'javascript:alert(1)' } })).toEqual({ text: 'x' });
    expect(outcomeOf({})).toBeUndefined();
  });

  it('falls back to its label, and survives a reload with what it carries', () => {
    expect(receiptText({ runId: 2, actionId: 'objects.rename', label: 'Renamed the board', undoable: true })).toBe('Done. Renamed the board');

    const back = readDoneReceipt({ runId: 3, actionId: 'hubspot.update', label: 'Update', undoable: true, record: { label: 'Northwind renewal', href: 'javascript:alert(1)' }, changes: [{ field: 'Stage', to: 'Won' }, { bad: true }], why: 'Within the trust bar.' });

    expect(back).toEqual({ runId: 3, actionId: 'hubspot.update', label: 'Update', undoable: true, record: { label: 'Northwind renewal' }, changes: [{ field: 'Stage', to: 'Won' }], why: 'Within the trust bar.' });
  });

  it('says "created" for a record it made, links its own page, and says plainly when a run did not run', () => {
    expect(receiptText({ runId: 4, actionId: 'hubspot.create', label: 'Create', undoable: true, created: true, record: { label: 'Northwind renewal' }, changes: [{ field: 'Amount', to: '$120,000' }] })).toBe('Done. Northwind renewal created: Amount: $120,000');
    expect(readDoneReceipt({ runId: 5, actionId: 'hubspot.update', label: 'Update', undoable: true, record: { label: 'Northwind renewal', href: 'https://app.hubspot.com/contacts/1/record/0-3/2' } })?.record?.href).toBe('https://app.hubspot.com/contacts/1/record/0-3/2');

    const failed = readDoneReceipt({ runId: 6, actionId: 'hubspot.update', label: 'Update', undoable: false, status: 'failed', error: 'HubSpot update failed: HubSpot API error 404', record: { label: 'Northwind renewal' } });

    expect(failed && receiptText(failed)).toBe('Didn\'t run. Northwind renewal: HubSpot update failed: HubSpot API error 404');
    expect(failureReason('HubSpot update failed: HubSpot API error 404: {"status":"error","message":"resource not found"}')).toBe('HubSpot update failed: HubSpot API error 404');
  });
});
