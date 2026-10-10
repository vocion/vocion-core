/**
 * `finance.post_journal_entry`: a balanced journal entry posted to the
 * connected books (an accrual, a reclass, a correction). It changes what the
 * books say; it moves no money and reaches no one outside. Undo deletes the
 * entry.
 *
 * Refused before anything is queued unless every line is a debit or a credit
 * (never both) and debits equal credits to the cent (`journalEntryProblem`).
 * Only a provider that can post and delete an entry offers it
 * (`FinanceProvider.postJournalEntry`, QuickBooks today); on any other, and on
 * the sample company, the precheck says so.
 *
 * `external: true` and `approvalRequired`: an agent's entry always waits for
 * a person's approval.
 */

import type { Action } from './types';
import { z } from 'zod';
import { journalEntryProblem } from '@/services/finance/types';

export const POST_JOURNAL_ENTRY_ACTION_ID = 'finance.post_journal_entry';

const journalEntryInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The entry\'s date, ISO (2026-09-30).'),
  memo: z.string().min(1).max(1000).describe('The entry\'s memo, as it will read in the books.'),
  lines: z.array(z.object({
    accountId: z.string().min(1).max(100).describe('The account, from finance_list kind=account.'),
    accountName: z.string().max(200).optional().describe('The account\'s name, for the card.'),
    debit: z.number().nonnegative().max(1_000_000_000).optional().describe('A debit in major units; leave out on a credit line.'),
    credit: z.number().nonnegative().max(1_000_000_000).optional().describe('A credit in major units; leave out on a debit line.'),
    description: z.string().max(500).optional(),
    className: z.string().max(200).optional().describe('A class to tag the line with, by its name in the books.'),
    customerId: z.string().max(100).optional().describe('A customer to tag the line with, from finance_list kind=customer.'),
  })).min(2).max(50),
  reason: z.string().min(1).max(1000).describe('Why the entry is needed, in a sentence.'),
  source: z.string().optional().describe('The finance source, when the workspace has more than one.'),
});

type Input = z.infer<typeof journalEntryInput>;

function figure(amount: number): string {
  return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function debits(input: Input): number {
  return input.lines.reduce((sum, line) => sum + (line.debit ?? 0), 0);
}

async function providerFor(orgId: string, source: string | null | undefined) {
  const { financeProviderFor } = await import('@/services/finance/provider');
  return financeProviderFor(orgId, { sourceSlug: source ?? null });
}

export const financePostJournalEntryAction: Action<typeof journalEntryInput> = {
  id: POST_JOURNAL_ENTRY_ACTION_ID,
  name: 'Post a journal entry',
  description: 'Post a balanced journal entry (debits equal credits) to the connected books. Changes the books, moves no money. Undo deletes the entry.',
  inputSchema: journalEntryInput,
  grant: 'post_journal_entry',
  external: true,
  approvalRequired: true,
  async precheck(ctx, input) {
    const problem = journalEntryProblem(input.lines);
    if (problem) {
      return problem;
    }
    try {
      const provider = await providerFor(ctx.orgId, input.source);
      if (!provider.postJournalEntry || !provider.deleteJournalEntry) {
        return provider.readOnlyReason ?? `${provider.vendor} does not take journal entries from here.`;
      }
      return undefined;
    } catch (err) {
      return (err as Error).message;
    }
  },
  async reviewCard(_ctx, raw) {
    const input = raw as Input;
    const amount = figure(debits(input));
    return {
      title: `Post a journal entry on ${input.date}: ${amount}`,
      system: 'Finance',
      headline: 'Post this entry to the books. Debits equal credits; no money moves. Undo deletes the entry.',
      badges: [{ label: 'Changes the books' }, { label: 'Moves no money' }, { label: 'Undo deletes the entry' }],
      fields: [
        { label: 'Date', value: input.date },
        { label: 'Memo', value: input.memo },
        ...input.lines.map((line, i) => ({
          label: `Line ${i + 1}`,
          value: `${line.debit ? `Debit ${figure(line.debit)}` : `Credit ${figure(line.credit ?? 0)}`} · ${line.accountName ? `${line.accountName} (${line.accountId})` : line.accountId}${line.description ? ` · ${line.description}` : ''}${line.className ? ` · class ${line.className}` : ''}`,
        })),
        { label: 'Total', value: amount },
        { label: 'Why', value: input.reason },
      ],
      nextAction: 'Approving posts the entry in the finance system.',
      verbs: { approve: 'Post entry', reject: 'Leave it' },
    };
  },
  async execute(ctx, input) {
    const problem = journalEntryProblem(input.lines);
    if (problem) {
      throw new Error(`${problem} Nothing was posted.`);
    }
    const provider = await providerFor(ctx.orgId, input.source);
    if (!provider.postJournalEntry) {
      throw new Error(provider.readOnlyReason ?? `${provider.vendor} does not take journal entries from here; nothing was posted.`);
    }
    const posted = await provider.postJournalEntry({ date: input.date, memo: input.memo, lines: input.lines });
    return {
      posted: true,
      id: posted.id,
      number: posted.number,
      url: posted.url,
      sourceSlug: provider.sourceSlug,
      line: `Posted a ${posted.currency ? `${posted.currency} ` : ''}${figure(posted.total)} journal entry dated ${input.date} in ${provider.vendor}.`,
    };
  },
  async undo(ctx, _input, result) {
    const id = typeof result?.id === 'string' ? result.id : null;
    if (!id) {
      return { note: 'This run recorded no journal entry, so there is nothing to delete.' };
    }
    const provider = await providerFor(ctx.orgId, typeof result.sourceSlug === 'string' ? result.sourceSlug : null);
    if (!provider.deleteJournalEntry) {
      throw new Error(`${provider.vendor} cannot delete the entry from here; delete journal entry ${id} in ${provider.vendor}.`);
    }
    await provider.deleteJournalEntry(id);
    return { deleted: true, id, line: `Deleted journal entry ${id} from ${provider.vendor}.` };
  },
};
