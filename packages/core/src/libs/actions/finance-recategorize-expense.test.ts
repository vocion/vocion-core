import type { ActionContext } from './types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolve = vi.fn();
vi.mock('@/services/finance/provider', () => ({ financeProviderFor: (...a: unknown[]) => resolve(...a) }));

const { financeRecategorizeExpenseAction: action } = await import('./finance-recategorize-expense');

const ctx = { orgId: 'org_a' } as ActionContext;
const input = action.inputSchema.parse({
  expenseId: '603',
  lineId: '1',
  toAccountId: '68',
  toAccountName: 'Office Supplies and Equipment',
  reason: 'A laptop for the operations coordinator is equipment, not marketing.',
});

const recategorizeExpense = vi.fn();

beforeEach(() => {
  resolve.mockReset();
  recategorizeExpense.mockReset();
  resolve.mockResolvedValue({ kind: 'quickbooks', vendor: 'QuickBooks', sourceSlug: 'books', kinds: [], list: vi.fn(), get: vi.fn(), recategorizeExpense });
});

describe('finance.recategorize_expense', () => {
  it('always waits for a person, and refuses where the books cannot be recoded, in words', async () => {
    expect(action).toMatchObject({ external: true, approvalRequired: true, grant: 'recategorize_expense' });
    await expect(action.precheck!(ctx, input)).resolves.toBeUndefined();

    resolve.mockResolvedValueOnce({ vendor: 'QuickBooks (sample company)', kinds: [], readOnlyReason: 'The QuickBooks sample company is read-only: nothing is written to its books.' });

    await expect(action.precheck!(ctx, input)).resolves.toBe('The QuickBooks sample company is read-only: nothing is written to its books.');

    resolve.mockResolvedValueOnce({ vendor: 'Stripe', kinds: [] });

    await expect(action.precheck!(ctx, input)).resolves.toBe('Stripe cannot move an expense line to another account from here.');
  });

  it('refuses an input without a reason', () => {
    expect(action.inputSchema.safeParse({ expenseId: '603', lineId: '1', toAccountId: '68' }).success).toBe(false);
  });

  it('shows where the line moves and that no money moves', async () => {
    const card = await action.reviewCard!(ctx, input);

    expect(card.title).toBe('Recategorize expense 603, line 1, to Office Supplies and Equipment');
    expect(card.badges).toEqual([{ label: 'Changes the books' }, { label: 'Moves no money' }, { label: 'Undo moves it back' }]);
  });

  it('records the account the line came from; Undo moves it back only if it is still where this run put it', async () => {
    recategorizeExpense.mockResolvedValueOnce({ expenseId: '603', lineId: '1', amount: 1299, party: 'Apple', from: { id: '62', name: 'Marketing' }, to: { id: '68', name: 'Office Supplies and Equipment' }, url: 'https://app.qbo.intuit.com/app/expense?txnId=603' });
    const result = await action.execute(ctx, input);

    expect(recategorizeExpense).toHaveBeenCalledWith({ expenseId: '603', lineId: '1', toAccountId: '68', toAccountName: 'Office Supplies and Equipment' });
    expect(result).toMatchObject({ recategorized: true, fromAccountId: '62', fromAccountName: 'Marketing', toAccountId: '68', sourceSlug: 'books', line: 'Moved line 1 of the Apple expense from Marketing to Office Supplies and Equipment in QuickBooks.' });

    recategorizeExpense.mockResolvedValueOnce({});
    const undone = await action.undo!(ctx, input, result as Record<string, unknown>);

    expect(resolve).toHaveBeenLastCalledWith('org_a', { sourceSlug: 'books' });
    expect(recategorizeExpense).toHaveBeenLastCalledWith({ expenseId: '603', lineId: '1', toAccountId: '62', toAccountName: 'Marketing', expectFromAccountId: '68' });
    expect(undone).toMatchObject({ restored: true, accountId: '62' });
  });

  it('has nothing to undo when the run recorded no move', async () => {
    await expect(action.undo!(ctx, input, {})).resolves.toEqual({ note: 'This run recorded no move, so there is nothing to put back.' });
  });
});
