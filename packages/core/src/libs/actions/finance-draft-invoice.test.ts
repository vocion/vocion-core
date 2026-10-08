import type { ActionContext } from './types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolve = vi.fn();
vi.mock('@/services/finance/provider', () => ({ financeProviderFor: (...a: unknown[]) => resolve(...a) }));

const { financeDraftInvoiceAction: action } = await import('./finance-draft-invoice');

const ctx = { orgId: 'org_a' } as ActionContext;
const input = action.inputSchema.parse({
  customerId: 'cus_FixtureContoso01',
  customerName: 'Contoso Supply',
  currency: 'usd',
  lines: [{ description: 'Onboarding workshop', unitAmount: 2500 }, { description: 'Support hours', quantity: 2, unitAmount: 500 }],
});

const draftInvoice = vi.fn();
const discardDraftInvoice = vi.fn();

beforeEach(() => {
  resolve.mockReset();
  draftInvoice.mockReset();
  discardDraftInvoice.mockReset();
  resolve.mockResolvedValue({ kind: 'stripe', vendor: 'Stripe', sourceSlug: 'billing', kinds: [], list: vi.fn(), get: vi.fn(), draftInvoice, discardDraftInvoice });
});

describe('finance.draft_invoice', () => {
  it('passes the precheck on a provider that can delete its drafts, and refuses one that cannot, in words', async () => {
    await expect(action.precheck!(ctx, input)).resolves.toBeUndefined();

    resolve.mockResolvedValueOnce({ vendor: 'NetSuite', kinds: [] });

    await expect(action.precheck!(ctx, input)).resolves.toBe('NetSuite is connected read-only here: Vocion drafts invoices only where the draft can be deleted again.');
  });

  it('shows the total and says it is a draft, never sent', async () => {
    const card = await action.reviewCard!(ctx, input);

    expect(card.title).toBe('Draft an invoice for Contoso Supply: USD 3,500.00');
    expect(card.badges).toEqual([{ label: 'Draft only' }, { label: 'Undo deletes the draft' }]);
  });

  it('creates the draft and records what Undo needs; Undo deletes it on the same source', async () => {
    draftInvoice.mockResolvedValue({ id: 'in_FixtureDraft01', number: null, url: 'https://dashboard.stripe.com/invoices/in_FixtureDraft01', total: 3500, currency: 'usd' });
    const result = await action.execute(ctx, input);

    expect(draftInvoice).toHaveBeenCalledWith({ customerId: 'cus_FixtureContoso01', currency: 'usd', daysUntilDue: undefined, memo: undefined, lines: [{ description: 'Onboarding workshop', quantity: 1, unitAmount: 2500 }, { description: 'Support hours', quantity: 2, unitAmount: 500 }] });
    expect(result).toMatchObject({ created: true, id: 'in_FixtureDraft01', sourceSlug: 'billing', line: 'Drafted a USD 3,500.00 invoice in Stripe for Contoso Supply; it is not sent.' });

    const undone = await action.undo!(ctx, input, result as Record<string, unknown>);

    expect(resolve).toHaveBeenLastCalledWith('org_a', { sourceSlug: 'billing' });
    expect(discardDraftInvoice).toHaveBeenCalledWith('in_FixtureDraft01');
    expect(undone).toMatchObject({ deleted: true, id: 'in_FixtureDraft01' });
  });

  it('has nothing to undo when the run recorded no draft', async () => {
    await expect(action.undo!(ctx, input, {})).resolves.toEqual({ note: 'This run recorded no draft, so there is nothing to delete.' });
  });
});
