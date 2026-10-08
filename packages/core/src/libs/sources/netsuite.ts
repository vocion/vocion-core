/**
 * NetSuite connector — an account's books, read-only: invoices, bills and
 * customer payments synced as searchable documents
 * (`services/finance/documents.ts`), and customers, vendors and accounts
 * read live by `finance_list` / `finance_get`
 * (`services/finance/providers/netsuite.ts`).
 *
 * Auth: token-based authentication (an integration's consumer key and
 * secret, an access token's id and secret), signed per request. Nothing
 * expires on our side, so there is no login and nothing to refresh.
 *
 * Incremental on `lastmodifieddate`; a deleted transaction never shows up in
 * that, so a daily full reconcile prunes what is gone.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { inspectByListing } from '@/libs/connectors/inspectByListing';
import { InspectInputError } from './inspect';

const netsuiteConfigSchema = z.object({});

export const netsuiteConnector: SourceConnector<typeof netsuiteConfigSchema> = {
  slug: 'netsuite',
  name: 'NetSuite',
  description: 'Read a NetSuite account\'s books — invoices, bills and customer payments as searchable documents; customers, vendors and accounts live. Read-only, token-based authentication.',
  icon: 'Landmark',
  authKind: 'apikey',
  configSchema: netsuiteConfigSchema,
  defaultReconcileCron: '0 4 * * *',
  inspectNote: 'Runs one SuiteQL read of each record kind. Read-only. Nothing is saved.',

  async inspect({ credentials }) {
    const { netsuiteFinanceProvider } = await import('@/services/finance/providers/netsuite');
    let provider;
    try {
      provider = netsuiteFinanceProvider({ orgId: '', source: { id: 0, slug: 'netsuite', config: {} }, credentials, persistence: { kind: 'never' } });
    } catch (error) {
      throw new InspectInputError((error as Error).message);
    }
    return inspectByListing(provider, null);
  },

  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const { netsuiteFinanceProvider } = await import('@/services/finance/providers/netsuite');
    const { syncFinanceRecords } = await import('@/services/finance/documents');
    const provider = netsuiteFinanceProvider({ orgId: ctx.orgId, source: { id: ctx.sourceId, slug: 'netsuite', config: ctx.config }, credentials: ctx.credentials ?? {}, persistence: { kind: 'never' } });
    yield* syncFinanceRecords(ctx, provider, ['invoice', 'bill', 'payment']);
  },
};
