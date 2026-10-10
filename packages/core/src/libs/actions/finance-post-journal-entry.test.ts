import type { ActionContext } from './types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolve = vi.fn();
vi.mock('@/services/finance/provider', () => ({ financeProviderFor: (...a: unknown[]) => resolve(...a) }));

const { financePostJournalEntryAction: action } = await import('./finance-post-journal-entry');

const ctx = { orgId: 'org_a' } as ActionContext;
const input = action.inputSchema.parse({
  date: '2026-09-30',
  memo: 'Accrue September workshop revenue earned but not yet invoiced.',
  lines: [
    { accountId: '90', accountName: 'Unbilled Receivables', debit: 2500 },
    { accountId: '79', accountName: 'Services Revenue', credit: 2500, className: 'Delivery' },
  ],
  reason: 'The Atlas Field Services workshop was delivered on 2026-09-29 and invoices in October.',
});

const postJournalEntry = vi.fn();
const deleteJournalEntry = vi.fn();

beforeEach(() => {
  resolve.mockReset();
  postJournalEntry.mockReset();
  deleteJournalEntry.mockReset();
  resolve.mockResolvedValue({ kind: 'quickbooks', vendor: 'QuickBooks', sourceSlug: 'books', kinds: [], list: vi.fn(), get: vi.fn(), postJournalEntry, deleteJournalEntry });
});

describe('finance.post_journal_entry', () => {
  it('refuses an unbalanced entry and a line that is both or neither, before asking the provider', async () => {
    const unbalanced = { ...input, lines: [{ accountId: '90', debit: 2500 }, { accountId: '79', credit: 2499.99 }] };

    await expect(action.precheck!(ctx, unbalanced)).resolves.toBe('Debits (2500.00) and credits (2499.99) differ by 0.01; a journal entry posts only when they are equal.');
    await expect(action.precheck!(ctx, { ...input, lines: [{ accountId: '90', debit: 10, credit: 10 }, { accountId: '79', credit: 0 }] })).resolves.toBe('Line 1 needs exactly one of a debit or a credit above zero.');
    await expect(action.execute(ctx, unbalanced)).rejects.toThrow(/differ by 0\.01.*Nothing was posted\./);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('balances to the cent, not to the float', async () => {
    const cents = { ...input, lines: [{ accountId: '1', debit: 0.1 }, { accountId: '2', debit: 0.2 }, { accountId: '3', credit: 0.3 }] };

    await expect(action.precheck!(ctx, cents)).resolves.toBeUndefined();
  });

  it('always waits for a person, and refuses the sample company and a vendor without entries, in words', async () => {
    expect(action).toMatchObject({ external: true, approvalRequired: true, grant: 'post_journal_entry' });
    await expect(action.precheck!(ctx, input)).resolves.toBeUndefined();

    resolve.mockResolvedValueOnce({ vendor: 'QuickBooks (sample company)', kinds: [], readOnlyReason: 'The QuickBooks sample company is read-only: nothing is written to its books.' });

    await expect(action.precheck!(ctx, input)).resolves.toBe('The QuickBooks sample company is read-only: nothing is written to its books.');

    resolve.mockResolvedValueOnce({ vendor: 'Ramp', kinds: [] });

    await expect(action.precheck!(ctx, input)).resolves.toBe('Ramp does not take journal entries from here.');
  });

  it('shows each debit and credit and the total', async () => {
    const card = await action.reviewCard!(ctx, input);

    expect(card.title).toBe('Post a journal entry on 2026-09-30: 2,500.00');
    expect(card.fields).toContainEqual({ label: 'Line 2', value: 'Credit 2,500.00 · Services Revenue (79) · class Delivery' });
  });

  it('posts the entry and records what Undo needs; Undo deletes it on the same source', async () => {
    postJournalEntry.mockResolvedValue({ id: '880', number: 'JE-17', url: 'https://app.qbo.intuit.com/app/journal?txnId=880', total: 2500, currency: 'USD' });
    const result = await action.execute(ctx, input);

    expect(postJournalEntry).toHaveBeenCalledWith({ date: '2026-09-30', memo: input.memo, lines: input.lines });
    expect(result).toMatchObject({ posted: true, id: '880', sourceSlug: 'books', line: 'Posted a USD 2,500.00 journal entry dated 2026-09-30 in QuickBooks.' });

    const undone = await action.undo!(ctx, input, result as Record<string, unknown>);

    expect(resolve).toHaveBeenLastCalledWith('org_a', { sourceSlug: 'books' });
    expect(deleteJournalEntry).toHaveBeenCalledWith('880');
    expect(undone).toMatchObject({ deleted: true, id: '880' });
  });
});
