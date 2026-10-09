/**
 * BigQuery connector — the capability carrier for the warehouse tools on
 * BigQuery, and nothing else.
 *
 * Queried LIVE (`warehouse_query`, `warehouse_schema`), never mirrored; see
 * `snowflake.ts` for why. Auth: a service account (`bigquery` platform),
 * exchanged for a short-lived access token per credential.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { BigqueryFetch } from '@/libs/bigquery/client';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { bigqueryCredentialsFrom, dryRunQuery, getDataset } from '@/libs/bigquery/client';
import { warehouseConfigShape } from '@/libs/warehouse/config';
import { qualifySchemas } from '@/libs/warehouse/guard';
import { InspectInputError } from './inspect';

export const bigqueryConfigSchema = z.object({
  /** Where the datasets live (US, EU, us-central1). Blank: BigQuery works it out from the datasets. */
  location: z.string().min(1).optional(),
  /** The most one query may bill, in gigabytes scanned. BigQuery refuses a query that would bill more. */
  maxGbBilled: z.number().int().min(1).max(100_000).default(10),
  ...warehouseConfigShape,
});

/**
 * Test connection: the service account gets a token and may plan a query
 * (a dry run of `SELECT 1`, which runs nothing and bills nothing), and each
 * allowed dataset is visible to it. Read-only and free. Nothing is saved.
 * @param input - Config and credential, as typed or as vaulted.
 * @param input.config - The source config.
 * @param input.credentials - The credential values.
 * @param doFetch - The network, injected in tests.
 */
export async function inspectBigquery(input: { config: Record<string, unknown>; credentials: Record<string, unknown> }, doFetch?: BigqueryFetch): Promise<ConnectorInspection> {
  const parsed = bigqueryCredentialsFrom(input.credentials);
  if (!parsed.ok) {
    throw new InspectInputError(parsed.message);
  }
  const config = bigqueryConfigSchema.safeParse(input.config);
  if (!config.success) {
    throw new InspectInputError('List at least one allowed dataset (as dataset or project.dataset) before testing.');
  }
  const creds = parsed.credentials;
  const checks: ConnectorCheck[] = [];
  try {
    await dryRunQuery(creds, { query: 'SELECT 1', location: config.data.location }, doFetch);
    checks.push({ key: 'auth', label: `Plans queries in ${creds.projectId} as ${creds.clientEmail}`, ok: true, detail: 'A dry run of SELECT 1 was accepted; nothing ran or was billed.' });
  } catch (err) {
    const message = (err as Error).message;
    checks.push({ key: 'auth', label: `Plans queries in ${creds.projectId} as ${creds.clientEmail}`, ok: false, detail: `${message} The service account needs BigQuery Job User on ${creds.projectId}.` });
    const status = (err as { status?: number }).status;
    return { reachable: status !== 0, authorized: false, checks, note: null, error: message };
  }
  for (const qualified of qualifySchemas(config.data.schemas, creds.projectId)) {
    const at = qualified.lastIndexOf('.');
    try {
      const dataset = await getDataset(creds, qualified.slice(0, at), qualified.slice(at + 1), doFetch);
      checks.push({ key: `dataset:${qualified}`, label: `Sees dataset ${qualified}`, ok: true, detail: dataset.location ? `Location ${dataset.location}.` : null });
    } catch (err) {
      checks.push({ key: `dataset:${qualified}`, label: `Sees dataset ${qualified}`, ok: false, detail: `${(err as Error).message} Grant the service account BigQuery Data Viewer on it.` });
    }
  }
  const failed = checks.filter(c => !c.ok);
  return {
    reachable: true,
    authorized: true,
    checks,
    note: 'Queries run only after a dry run says they are a SELECT over these datasets, under the source\'s cap on bytes billed.',
    error: failed.length > 0 ? failed.map(c => c.detail).filter(Boolean).join(' ') : null,
  };
}

export const bigqueryConnector: SourceConnector<typeof bigqueryConfigSchema> = {
  slug: 'bigquery',
  name: 'BigQuery',
  description: 'Your BigQuery datasets, queried live and read-only: one SELECT at a time over the datasets you allow, capped in rows, size, time and bytes billed. Nothing is copied into Vocion.',
  icon: 'Database',
  category: 'data-analytics',
  brand: 'googlebigquery',
  authKind: 'apikey',
  syncless: true,
  configSchema: bigqueryConfigSchema,
  inspectNote: 'Dry-runs SELECT 1 and looks up each allowed dataset. Read-only and free. Nothing is saved.',

  async inspect({ config, credentials }) {
    return inspectBigquery({ config, credentials });
  },

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // Read live by the warehouse tools, never mirrored.
  },
};
