/**
 * Xero connector — an organisation's books, read-only: invoices, bills and
 * payments synced as searchable documents (`services/finance/documents.ts`),
 * and customers, vendors and accounts read live by `finance_list` /
 * `finance_get` (`services/finance/providers/xero.ts`).
 *
 * Auth: a "Connect with Xero" login (the refresh token Xero rotates is saved
 * on every renewal), or a pasted custom connection (client ID and secret,
 * no OAuth app on this server needed).
 *
 * Incremental: with `ctx.since`, each list sends `If-Modified-Since`. A
 * deleted or voided record never shows up in that, so a daily full
 * reconcile re-reads the books and prunes what is gone.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { testConnectionPersistence } from '@/libs/connect/loginGrant';
import { inspectByListing } from '@/libs/connectors/inspectByListing';
import { InspectInputError } from './inspect';

const xeroConfigSchema = z.object({
  /** The organisation to read, when one login covers several. Blank: the login's own. */
  tenantId: z.string().optional(),
});

export const xeroConnector: SourceConnector<typeof xeroConfigSchema> = {
  slug: 'xero',
  name: 'Xero',
  brand: 'xero',
  description: 'Read a Xero organisation\'s books — invoices, bills and payments as searchable documents; customers, vendors and accounts live. Read-only.',
  icon: 'Landmark',
  category: 'finance-people',
  authKind: 'oauth',
  configSchema: xeroConfigSchema,
  defaultReconcileCron: '45 3 * * *',
  inspectNote: 'Reads one customer, vendor, invoice, bill, payment and account. Read-only. Nothing is saved.',

  async inspect({ config, credentials, savedSource }) {
    const { xeroFinanceProvider } = await import('@/services/finance/providers/xero');
    let provider;
    try {
      provider = await xeroFinanceProvider({ orgId: savedSource?.orgId ?? '', source: { id: savedSource?.sourceId ?? 0, slug: 'xero', config }, credentials, persistence: testConnectionPersistence('xero', savedSource) });
    } catch (error) {
      throw new InspectInputError((error as Error).message);
    }
    const tenant = typeof credentials.tenantName === 'string' && credentials.tenantName ? `Organisation: ${credentials.tenantName}.` : null;
    return inspectByListing(provider, tenant);
  },

  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const { xeroFinanceProvider } = await import('@/services/finance/providers/xero');
    const { syncFinanceRecords } = await import('@/services/finance/documents');
    const provider = await xeroFinanceProvider({
      orgId: ctx.orgId,
      source: { id: ctx.sourceId, slug: 'xero', config: ctx.config },
      credentials: ctx.credentials ?? {},
      persistence: { kind: 'persist', orgId: ctx.orgId, sourceId: ctx.sourceId, warn: message => ctx.onProgress?.({ kind: 'error', message }) },
    });
    yield* syncFinanceRecords(ctx, provider, ['invoice', 'bill', 'payment']);
  },
};
