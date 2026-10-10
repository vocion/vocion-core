/**
 * `finance.recategorize_expense`: one line of a card or bank expense moved
 * to another account in the connected books. The books change (which
 * account the line counts against); no money moves and nothing reaches a
 * vendor. Undo moves the line back, and only while it is still where this
 * run put it.
 *
 * Only a provider that can recode an expense line offers it
 * (`FinanceProvider.recategorizeExpense`, QuickBooks today); on any other,
 * and on the sample company, the precheck says so.
 *
 * `external: true` and `approvalRequired`: the change lands in books an
 * accountant closes, so an agent's proposal always waits for a person.
 */

import type { Action } from './types';
import { z } from 'zod';

export const RECATEGORIZE_EXPENSE_ACTION_ID = 'finance.recategorize_expense';

const recategorizeInput = z.object({
  expenseId: z.string().min(1).max(100).describe('The expense\'s id, from finance_list kind=transaction.'),
  lineId: z.string().min(1).max(100).describe('The line\'s id, from finance_get kind=transaction.'),
  toAccountId: z.string().min(1).max(100).describe('The account to move the line to, from finance_list kind=account.'),
  toAccountName: z.string().max(200).optional().describe('That account\'s name, for the card.'),
  reason: z.string().min(1).max(1000).describe('Why the line belongs in that account, in a sentence.'),
  source: z.string().optional().describe('The finance source, when the workspace has more than one.'),
});

type Input = z.infer<typeof recategorizeInput>;

async function providerFor(orgId: string, source: string | null | undefined) {
  const { financeProviderFor } = await import('@/services/finance/provider');
  return financeProviderFor(orgId, { sourceSlug: source ?? null });
}

export const financeRecategorizeExpenseAction: Action<typeof recategorizeInput> = {
  id: RECATEGORIZE_EXPENSE_ACTION_ID,
  name: 'Recategorize an expense',
  description: 'Move one line of a card or bank expense to another account in the connected books. Changes the books, moves no money. Undo moves it back.',
  inputSchema: recategorizeInput,
  grant: 'recategorize_expense',
  external: true,
  approvalRequired: true,
  dedupKeyFor: input => `${input.source ?? ''}:${input.expenseId}:${input.lineId}`,
  async precheck(ctx, input) {
    try {
      const provider = await providerFor(ctx.orgId, input.source);
      if (!provider.recategorizeExpense) {
        return provider.readOnlyReason ?? `${provider.vendor} cannot move an expense line to another account from here.`;
      }
      return undefined;
    } catch (err) {
      return (err as Error).message;
    }
  },
  async reviewCard(_ctx, raw) {
    const input = raw as Input;
    const to = input.toAccountName ? `${input.toAccountName} (${input.toAccountId})` : input.toAccountId;
    return {
      title: `Recategorize expense ${input.expenseId}, line ${input.lineId}, to ${input.toAccountName ?? `account ${input.toAccountId}`}`,
      system: 'Finance',
      headline: 'Move this expense line to another account. The books change; no money moves. Undo moves it back.',
      badges: [{ label: 'Changes the books' }, { label: 'Moves no money' }, { label: 'Undo moves it back' }],
      fields: [
        { label: 'Expense', value: input.expenseId },
        { label: 'Line', value: input.lineId },
        { label: 'Moves to', value: to },
        { label: 'Why', value: input.reason },
      ],
      nextAction: 'Approving recodes the line in the finance system; the expense\'s amount and payee stay as they are.',
      verbs: { approve: 'Recategorize', reject: 'Leave it' },
    };
  },
  async execute(ctx, input) {
    const provider = await providerFor(ctx.orgId, input.source);
    if (!provider.recategorizeExpense) {
      throw new Error(provider.readOnlyReason ?? `${provider.vendor} cannot move an expense line from here; nothing changed.`);
    }
    const moved = await provider.recategorizeExpense({ expenseId: input.expenseId, lineId: input.lineId, toAccountId: input.toAccountId, toAccountName: input.toAccountName });
    const from = moved.from.name ?? `account ${moved.from.id}`;
    const to = moved.to.name ?? `account ${moved.to.id}`;
    return {
      recategorized: true,
      expenseId: moved.expenseId,
      lineId: moved.lineId,
      fromAccountId: moved.from.id,
      fromAccountName: moved.from.name,
      toAccountId: moved.to.id,
      toAccountName: moved.to.name,
      url: moved.url,
      sourceSlug: provider.sourceSlug,
      line: `Moved line ${moved.lineId} of ${moved.party ? `the ${moved.party} expense` : `expense ${moved.expenseId}`} from ${from} to ${to} in ${provider.vendor}.`,
    };
  },
  async undo(ctx, _input, result) {
    const expenseId = typeof result?.expenseId === 'string' ? result.expenseId : null;
    const lineId = typeof result?.lineId === 'string' ? result.lineId : null;
    const fromAccountId = typeof result?.fromAccountId === 'string' ? result.fromAccountId : null;
    const toAccountId = typeof result?.toAccountId === 'string' ? result.toAccountId : null;
    if (!expenseId || !lineId || !fromAccountId || !toAccountId) {
      return { note: 'This run recorded no move, so there is nothing to put back.' };
    }
    const provider = await providerFor(ctx.orgId, typeof result.sourceSlug === 'string' ? result.sourceSlug : null);
    if (!provider.recategorizeExpense) {
      throw new Error(`${provider.vendor} cannot move the line back from here; recode line ${lineId} of expense ${expenseId} in ${provider.vendor}.`);
    }
    const fromAccountName = typeof result.fromAccountName === 'string' ? result.fromAccountName : undefined;
    // Re-read at the current SyncToken, and only if no one has moved it since.
    await provider.recategorizeExpense({ expenseId, lineId, toAccountId: fromAccountId, toAccountName: fromAccountName, expectFromAccountId: toAccountId });
    return { restored: true, expenseId, lineId, accountId: fromAccountId, line: `Moved line ${lineId} of expense ${expenseId} back to ${fromAccountName ?? `account ${fromAccountId}`} in ${provider.vendor}.` };
  },
};
