/**
 * Stripe connector — the capability carrier for the finance family's Stripe
 * reads (`services/finance/providers/stripe.ts`), and nothing else.
 *
 * Stripe is read LIVE: what a customer owes, whether an invoice was paid,
 * when the next payout lands are true only as of the moment they are asked,
 * and a mirror would copy customers' contact details into the index for no
 * gain. So this connector ingests nothing (`syncless`), like Sentry's and
 * Apollo's. What registering it buys is the key in the vault, a Stripe tile
 * on Connections, `finance_list` / `finance_get` for agents given the source,
 * and a Test connection that reads one record of each kind the key may see.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { inspectByListing } from '@/libs/connectors/inspectByListing';
import { InspectInputError } from './inspect';

const stripeConfigSchema = z.object({});

export const stripeConnector: SourceConnector<typeof stripeConfigSchema> = {
  slug: 'stripe',
  name: 'Stripe',
  brand: 'stripe',
  description: 'Billing, read live: customers, invoices and what is still owed, subscriptions, payments and payouts. Read-only, except a draft invoice an agent may prepare, never sent.',
  icon: 'CreditCard',
  category: 'finance-people',
  authKind: 'apikey',
  syncless: true,
  configSchema: stripeConfigSchema,
  inspectNote: 'Reads one customer, invoice, subscription, payment and payout. Read-only and free. Nothing is saved.',

  async inspect({ credentials }) {
    const { stripeFinanceProvider } = await import('@/services/finance/providers/stripe');
    let provider;
    try {
      provider = stripeFinanceProvider({ orgId: '', source: { id: 0, slug: 'stripe', config: {} }, credentials, persistence: { kind: 'never' } });
    } catch (error) {
      throw new InspectInputError((error as Error).message);
    }
    const key = String(credentials.apiKey ?? '');
    const note = key.startsWith('sk_')
      ? 'This is a secret key, which reads (and can change) everything. A restricted key with Read on these five is all Vocion needs.'
      : key.includes('_test_') ? 'Test-mode key: it reads Stripe\'s test data, not live billing.' : null;
    return inspectByListing(provider, note);
  },

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // Read live by finance_list / finance_get, never mirrored.
  },
};
