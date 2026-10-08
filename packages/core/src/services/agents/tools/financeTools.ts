/**
 * The finance family's reads — the connected billing, books, spend or
 * payables system, live, with this workspace's own credential.
 *
 *   finance_list  records of one kind (customers, invoices, bills, payments,
 *                 subscriptions, payouts, card spend, reimbursements,
 *                 vendors, accounts), filtered by text, status and dates.
 *   finance_get   one record whole, with its lines.
 *
 * Present for an agent whose `connectorSources` include a finance source
 * (`familyInScope`), narrowed by the person's source ACL; the provider is the
 * source's (`services/finance/provider.ts`), never named by the agent. The
 * one write, a draft invoice, is the `finance.draft_invoice` action.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import type { FinanceRecordKind } from '@/services/finance/types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { familyInScope, familySourceSlugs } from '@/libs/connectors/families';
import { FINANCE_DEFAULT_LIMIT, FINANCE_MAX_LIMIT, FINANCE_RECORD_KINDS } from '@/services/finance/types';

export const FINANCE_LIST_TOOL = 'finance_list';
export const FINANCE_GET_TOOL = 'finance_get';

export function financeTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!familyInScope(ctx, 'finance')) {
    return [];
  }
  return [listTool(ctx), getTool(ctx)];
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
      description: 'One record from the connected finance system, read live and whole: an invoice or bill with every line, what is still owed and its due date; a customer or vendor with its contact; a payment, payout, subscription or card transaction with its details; and its link into the vendor. Take the id from finance_list.',
      schema: z.object({
        kind: z.enum(FINANCE_RECORD_KINDS).describe('What the record is.'),
        id: z.string().min(1).max(100).describe('The record\'s id, from finance_list.'),
        source: z.string().optional().describe('The finance source to read, when this agent reaches more than one.'),
      }),
    },
  );
}
