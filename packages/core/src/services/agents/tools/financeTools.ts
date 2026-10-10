/**
 * The finance family's reads — the connected billing, books, spend or
 * payables system, live, with this workspace's own credential.
 *
 *   finance_list  records of one kind (customers, invoices, bills, payments,
 *                 subscriptions, payouts, card spend, reimbursements,
 *                 vendors, accounts), filtered by text, status and dates.
 *   finance_get   one record whole, with its lines.
 *   finance_report  a profit and loss or a balance sheet, as the vendor
 *                 runs it, where the vendor runs statements.
 *
 * Present for an agent whose `connectorSources` include a finance source
 * (`familyInScope`), narrowed by the person's source ACL; the provider is the
 * source's (`services/finance/provider.ts`), never named by the agent. The
 * writes are actions: `finance.draft_invoice`, `finance.recategorize_expense`
 * and `finance.post_journal_entry`.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import type { FinanceRecordKind, FinanceReportRow } from '@/services/finance/types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { familyInScope, familySourceSlugs } from '@/libs/connectors/families';
import { FINANCE_DEFAULT_LIMIT, FINANCE_MAX_LIMIT, FINANCE_RECORD_KINDS, FINANCE_REPORT_KINDS, FINANCE_REPORT_SUMMARIES } from '@/services/finance/types';

export const FINANCE_LIST_TOOL = 'finance_list';
export const FINANCE_GET_TOOL = 'finance_get';
export const FINANCE_REPORT_TOOL = 'finance_report';

export function financeTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!familyInScope(ctx, 'finance')) {
    return [];
  }
  return [listTool(ctx), getTool(ctx), reportTool(ctx)];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

async function providerFor(ctx: RuntimeContext, source: string | undefined) {
  const { financeProviderFor } = await import('@/services/finance/provider');
  return financeProviderFor(ctx.orgId, { sourceSlug: source ?? null, allowed: familySourceSlugs(ctx, 'finance') });
}

function listTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        for (const [name, value] of [['since', args.since], ['until', args.until]] as const) {
          if (value && !ISO_DATE.test(value)) {
            return JSON.stringify({ ok: false, error: `${name} is an ISO date, e.g. 2026-09-01.` });
          }
        }
        const provider = await providerFor(ctx, args.source);
        const kind = args.kind as FinanceRecordKind;
        if (!provider.kinds.includes(kind)) {
          return JSON.stringify({ ok: false, error: `${provider.vendor} holds no ${kind} records here. It holds: ${provider.kinds.join(', ')}.` });
        }
        const page = await provider.list(kind, {
          query: args.query?.trim() || undefined,
          status: args.status?.trim() || undefined,
          since: args.since,
          until: args.until,
          partyId: args.party_id?.trim() || undefined,
          limit: Math.min(args.limit ?? FINANCE_DEFAULT_LIMIT, FINANCE_MAX_LIMIT),
          cursor: args.cursor ?? null,
        });
        return JSON.stringify({
          ok: true,
          vendor: provider.vendor,
          source: provider.sourceSlug,
          kind,
          count: page.records.length,
          records: page.records,
          nextCursor: page.nextCursor,
          ...(page.ignored?.length ? { ignored: page.ignored } : {}),
          note: page.records.length === 0
            ? 'Nothing matched.'
            : `Amounts are in major units of each record's currency. ${page.nextCursor ? 'More records exist: pass nextCursor as cursor. ' : ''}Read one whole with finance_get; cite its url.`,
        });
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message });
      }
    },
    {
      name: FINANCE_LIST_TOOL,
      description: 'List records from the connected finance system (billing, accounting, spend or payables — whichever this workspace connected), read live: customers, vendors, invoices, bills, payments, subscriptions, payouts, card transactions, reimbursements or accounts. Each record has its id, number, party, status, amount, currency, balance still owed, dates and a link into the vendor. Filter by text (a name, number or email), the vendor\'s status word, a date range, or one customer or vendor. Use it for who owes what, what was paid, what we spent and with whom.',
      schema: z.object({
        kind: z.enum(FINANCE_RECORD_KINDS).describe('Which records.'),
        query: z.string().max(200).optional().describe('A name, number or email to look for.'),
        status: z.string().max(40).optional().describe('The vendor\'s own status word, e.g. open, paid, draft, AUTHORISED.'),
        since: z.string().max(40).optional().describe('Only records dated on or after this ISO date.'),
        until: z.string().max(40).optional().describe('Only records dated on or before this ISO date.'),
        party_id: z.string().max(100).optional().describe('Only records of this customer or vendor (its id, from kind=customer or kind=vendor).'),
        limit: z.number().int().min(1).max(FINANCE_MAX_LIMIT).optional().describe(`How many (default ${FINANCE_DEFAULT_LIMIT}).`),
        cursor: z.string().max(500).optional().describe('nextCursor from the previous page.'),
        source: z.string().optional().describe('The finance source to read, when this agent reaches more than one.'),
      }),
    },
  );
}

function getTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const provider = await providerFor(ctx, args.source);
        const kind = args.kind as FinanceRecordKind;
        if (!provider.kinds.includes(kind)) {
          return JSON.stringify({ ok: false, error: `${provider.vendor} holds no ${kind} records here. It holds: ${provider.kinds.join(', ')}.` });
        }
        const record = await provider.get(kind, args.id.trim());
        return JSON.stringify({ ok: true, vendor: provider.vendor, source: provider.sourceSlug, record, note: 'Amounts are in major units of the record\'s currency. Cite its url.' });
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message });
      }
    },
    {
      name: FINANCE_GET_TOOL,
      description: 'One record from the connected finance system, read live and whole: an invoice or bill with every line, what is still owed and its due date; a customer or vendor with its contact; a payment, payout, subscription or card transaction with its details (a card or bank expense with the account each line is coded to, and each line\'s id); and its link into the vendor. Take the id from finance_list.',
      schema: z.object({
        kind: z.enum(FINANCE_RECORD_KINDS).describe('What the record is.'),
        id: z.string().min(1).max(100).describe('The record\'s id, from finance_list.'),
        source: z.string().optional().describe('The finance source to read, when this agent reaches more than one.'),
      }),
    },
  );
}

/**
 * How many account lines a statement holds, through its sections; a total
 * standing alone at the top (Net Income) is not one.
 * @param rows - The statement's rows.
 * @param nested - Whether these rows sit inside a section.
 */
function lineCount(rows: FinanceReportRow[], nested = false): number {
  return rows.reduce((n, r) => n + (r.rows ? lineCount(r.rows, true) : nested ? 1 : 0), 0);
}

function reportTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        for (const [name, value] of [['start', args.start], ['end', args.end]] as const) {
          if (value && !ISO_DATE.test(value)) {
            return JSON.stringify({ ok: false, error: `${name} is an ISO date, e.g. 2026-09-30.` });
          }
        }
        if (args.start && args.start > args.end) {
          return JSON.stringify({ ok: false, error: 'start is after end.' });
        }
        const provider = await providerFor(ctx, args.source);
        if (!provider.report) {
          return JSON.stringify({ ok: false, error: `${provider.vendor} runs no statements here. Sum finance_list records instead (invoices and bills for income and costs, accounts for balances).` });
        }
        const report = await provider.report(args.kind, { start: args.start, end: args.end, summarizeBy: args.summarize_by, basis: args.basis });
        return JSON.stringify({
          ok: true,
          sections: report.rows.filter(r => r.rows).length,
          lines: lineCount(report.rows),
          columns: report.columns.length,
          vendor: provider.vendor,
          source: provider.sourceSlug,
          report,
          note: `Amounts are in major units${report.currency ? ` of ${report.currency}` : ''}, one per column (${report.columns.join(', ')}). Quote the vendor's own totals rather than re-adding lines.`,
        });
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message });
      }
    },
    {
      name: FINANCE_REPORT_TOOL,
      description: 'Run a statement in the connected accounting system, live: a profit and loss over a period, or a balance sheet as of a date. Returns the vendor\'s own sections (income, expenses, assets, liabilities, equity), each account line with its amounts, section totals and the bottom lines (net income, total assets), by total or split by month, class or customer. Use it for how the business did over a period and what it owns and owes; not every finance system runs statements, and it says so when it does not.',
      schema: z.object({
        kind: z.enum(FINANCE_REPORT_KINDS).describe('profit_and_loss over a period, or balance_sheet as of end.'),
        end: z.string().max(40).describe('The last day of the period, or the balance sheet\'s date (ISO).'),
        start: z.string().max(40).optional().describe('The first day of a profit and loss (ISO); the start of end\'s year when omitted.'),
        summarize_by: z.enum(FINANCE_REPORT_SUMMARIES).optional().describe('One total column (default), or a column per month, class or customer.'),
        basis: z.enum(['accrual', 'cash']).optional().describe('Accounting basis; the company\'s own setting when omitted.'),
        source: z.string().optional().describe('The finance source to read, when this agent reaches more than one.'),
      }),
    },
  );
}
