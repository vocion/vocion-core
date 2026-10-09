/**
 * Ramp connector — the capability carrier for the finance family's Ramp
 * reads (`services/finance/providers/ramp.ts`), and nothing else.
 *
 * Ramp is read LIVE: card spend, reimbursements and bills change by the
 * minute, and a mirror would copy cardholders' names into the index for no
 * gain. So this connector ingests nothing (`syncless`). Registering it buys
 * the app's credential in the vault, a Ramp tile on Connections,
 * `finance_list` / `finance_get` for agents given the source, and a Test
 * connection that reads one record of each kind the app may see.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { inspectByListing } from '@/libs/connectors/inspectByListing';
import { InspectInputError } from './inspect';

const rampConfigSchema = z.object({
  /** https://demo-api.ramp.com for a Ramp sandbox. */
  baseUrl: z.string().url().default('https://api.ramp.com'),
});

export const rampConnector: SourceConnector<typeof rampConfigSchema> = {
  slug: 'ramp',
  name: 'Ramp',
  brand: 'ramp',
  description: 'Company spend, read live: card transactions, reimbursements, bills and vendors. Read-only — Vocion never issues a card, approves or pays.',
  icon: 'Wallet',
  category: 'finance-people',
  authKind: 'apikey',
  syncless: true,
  configSchema: rampConfigSchema,
  inspectNote: 'Gets a token, then reads one transaction, reimbursement, bill and vendor. Read-only and free. Nothing is saved.',

  async inspect({ config, credentials }) {
    const { rampFinanceProvider } = await import('@/services/finance/providers/ramp');
    let provider;
    try {
      provider = rampFinanceProvider({ orgId: '', source: { id: 0, slug: 'ramp', config: rampConfigSchema.parse(config ?? {}) }, credentials, persistence: { kind: 'never' } });
    } catch (error) {
      throw new InspectInputError((error as Error).message);
    }
    const sandbox = String(config?.baseUrl ?? '').includes('demo-api') ? 'Sandbox app: it reads Ramp\'s demo data, not live spend.' : null;
    return inspectByListing(provider, sandbox);
  },

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // Read live by finance_list / finance_get, never mirrored.
  },
};
