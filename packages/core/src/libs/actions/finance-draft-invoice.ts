/**
 * `finance.draft_invoice` — an invoice prepared in the connected finance
 * system as a DRAFT: never finalized, never sent, never charged. A person
 * reviews and sends it from the vendor's own app. Undo deletes the draft.
 *
 * Only a provider whose vendor has a deletable draft state offers it
 * (`FinanceProvider.draftInvoice`); on any other the precheck says so. No
 * other finance write exists: nothing here moves money.
 *
 * `external: true`, `medium`: the draft sits in the customer's books where
 * finance people see it, but it is deleted in one move and reaches no customer.
 */

import type { Action } from './types';
import { z } from 'zod';

export const DRAFT_INVOICE_ACTION_ID = 'finance.draft_invoice';

const draftInvoiceInput = z.object({
  customerId: z.string().min(1).max(100).describe('The customer\'s id in the finance system, from finance_list kind=customer.'),
  customerName: z.string().max(200).optional().describe('The customer\'s name, for the card.'),
  lines: z.array(z.object({
    description: z.string().min(1).max(500),
    quantity: z.number().positive().max(1_000_000).default(1),
    unitAmount: z.number().nonnegative().max(100_000_000).describe('Price per unit in major units (dollars, not cents).'),
  })).min(1).max(50),
  currency: z.string().regex(/^[a-z]{3}$/i).optional().describe('Three-letter currency code; the customer\'s or the account\'s default when omitted.'),
  daysUntilDue: z.number().int().min(0).max(365).optional().describe('Days until due once it is sent (default 30).'),
  memo: z.string().max(1000).optional().describe('A note shown on the invoice.'),
  source: z.string().optional().describe('The finance source, when the workspace has more than one.'),
});

type Input = z.infer<typeof draftInvoiceInput>;

function total(input: Input): number {
  return input.lines.reduce((sum, line) => sum + line.quantity * line.unitAmount, 0);
}

export const financeDraftInvoiceAction: Action<typeof draftInvoiceInput> = {
  id: DRAFT_INVOICE_ACTION_ID,
  name: 'Draft an invoice',
  description: 'Prepare an invoice in the connected finance system as a draft — never finalized, sent or charged; a person sends it from the vendor\'s app. Undo deletes the draft.',
  inputSchema: draftInvoiceInput,
  grant: 'draft_invoice',
  external: true,
  async precheck(ctx, input) {
    try {
      const { financeProviderFor } = await import('@/services/finance/provider');
      const provider = await financeProviderFor(ctx.orgId, { sourceSlug: input.source ?? null });
      if (!provider.draftInvoice || !provider.discardDraftInvoice) {
        return `${provider.vendor} is connected read-only here: Vocion drafts invoices only where the draft can be deleted again.`;
      }
      return undefined;
    } catch (err) {
      return (err as Error).message;
    }
  },
  async reviewCard(_ctx, raw) {
    const input = raw as Input;
    const currency = (input.currency ?? '').toUpperCase();
    const amount = total(input).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return {
      title: `Draft an invoice${input.customerName ? ` for ${input.customerName}` : ''}: ${currency ? `${currency} ` : ''}${amount}`,
      system: 'Finance',
      headline: 'Create this invoice as a draft. It is not sent or charged; Undo deletes it.',
      badges: [{ label: 'Draft only' }, { label: 'Undo deletes the draft' }],
      fields: [
        { label: 'Customer', value: input.customerName ? `${input.customerName} (${input.customerId})` : input.customerId },
        ...input.lines.map((line, i) => ({ label: `Line ${i + 1}`, value: `${line.quantity} × ${line.description} @ ${line.unitAmount}` })),
        { label: 'Total', value: `${currency ? `${currency} ` : ''}${amount}` },
        ...(input.memo ? [{ label: 'Memo', value: input.memo }] : []),
      ],
      nextAction: 'Approving creates the draft; sending it stays a person\'s move in the finance system.',
      verbs: { approve: 'Create draft', reject: 'Leave it' },
    };
  },
  async execute(ctx, input) {
    const { financeProviderFor } = await import('@/services/finance/provider');
    const provider = await financeProviderFor(ctx.orgId, { sourceSlug: input.source ?? null });
    if (!provider.draftInvoice) {
      throw new Error(`${provider.vendor} is connected read-only here; no draft was created.`);
    }
    const draft = await provider.draftInvoice({
      customerId: input.customerId,
      currency: input.currency?.toLowerCase(),
      daysUntilDue: input.daysUntilDue,
      memo: input.memo,
      lines: input.lines.map(line => ({ description: line.description, quantity: line.quantity, unitAmount: line.unitAmount })),
    });
    const figure = draft.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return {
      created: true,
      id: draft.id,
      number: draft.number,
      url: draft.url,
      sourceSlug: provider.sourceSlug,
      line: `Drafted a ${draft.currency.toUpperCase()} ${figure} invoice in ${provider.vendor}${input.customerName ? ` for ${input.customerName}` : ''}; it is not sent.`,
    };
  },
  async undo(ctx, _input, result) {
    const id = typeof result?.id === 'string' ? result.id : null;
    if (!id) {
      return { note: 'This run recorded no draft, so there is nothing to delete.' };
    }
    const { financeProviderFor } = await import('@/services/finance/provider');
    const provider = await financeProviderFor(ctx.orgId, { sourceSlug: typeof result?.sourceSlug === 'string' ? result.sourceSlug : null });
    if (!provider.discardDraftInvoice) {
      throw new Error(`${provider.vendor} cannot delete the draft from here; delete ${id} in ${provider.vendor}.`);
    }
    await provider.discardDraftInvoice(id);
    return { deleted: true, id, line: `Deleted the draft invoice ${id} from ${provider.vendor}.` };
  },
};
