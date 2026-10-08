/**
 * BILL connector — the capability carrier for the finance family's BILL
 * reads (`services/finance/providers/bill.ts`), and nothing else.
 *
 * BILL is read LIVE: whether a bill is approved, scheduled or paid is true
 * only as of the moment it is asked. So this connector ingests nothing
 * (`syncless`). Registering it buys the API user's sign-in in the vault, a
 * BILL tile on Connections, `finance_list` / `finance_get` for agents given
 * the source, and a Test connection that signs in and reads one record of
 * each kind.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { inspectByListing } from '@/libs/connectors/inspectByListing';
import { InspectInputError } from './inspect';

const billConfigSchema = z.object({
  /** A BILL sandbox (developer) organization. */
  sandbox: z.boolean().default(false),
});

export const billConnector: SourceConnector<typeof billConfigSchema> = {
  slug: 'bill',
  name: 'BILL',
  description: 'Payables and receivables, read live: bills with their approval and payment status, vendors, invoices and customers. Read-only — Vocion never pays, approves or sends.',
  icon: 'Receipt',
  authKind: 'apikey',
  syncless: true,
  configSchema: billConfigSchema,
  inspectNote: 'Signs in, then reads one bill, vendor, invoice and customer. Read-only and free. Nothing is saved.',

  async inspect({ config, credentials }) {
    const { billFinanceProvider } = await import('@/services/finance/providers/bill');
    let provider;
    try {
      provider = billFinanceProvider({ orgId: '', source: { id: 0, slug: 'bill', config: billConfigSchema.parse(config ?? {}) }, credentials, persistence: { kind: 'never' } });
    } catch (error) {
      throw new InspectInputError((error as Error).message);
    }
    return inspectByListing(provider, config?.sandbox === true ? 'Sandbox organization: it reads BILL\'s sandbox, not live payables.' : null);
  },

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // Read live by finance_list / finance_get, never mirrored.
  },
};
