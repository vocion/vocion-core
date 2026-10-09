/**
 * Databricks connector — the capability carrier for the warehouse tools on a
 * Databricks SQL warehouse, and nothing else.
 *
 * Queried LIVE (`warehouse_query`, `warehouse_schema`) through the SQL
 * Statement Execution API, never mirrored; see `snowflake.ts` for why. Auth:
 * a personal access token and the workspace URL (`databricks` platform).
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { databricksCredentialsFrom, readDatabricksWarehouse, runDatabricksStatement } from '@/libs/databricks/client';
import { warehouseConfigShape } from '@/libs/warehouse/config';
import { qualifySchemas } from '@/libs/warehouse/guard';
import { InspectInputError } from './inspect';

export const databricksConfigSchema = z.object({
  /** The SQL warehouse that runs the queries — the id in its Connection details. */
  warehouseId: z.string().min(1),
  /** The catalog an allowlist entry without one is in, e.g. main. */
  catalog: z.string().min(1),
  ...warehouseConfigShape,
});

function check(key: string, label: string, ok: boolean, detail: string | null): ConnectorCheck {
  return { key, label, ok, detail };
}

/**
 * Test connection: the token reads the SQL warehouse, a `SELECT 1` runs on
 * it, and each allowed schema is in the catalog's information schema.
 * Nothing is saved.
 * @param input - Config and credential, as typed or as vaulted.
 * @param input.config - The source config, possibly partial.
 * @param input.credentials - The credential values.
 * @param doFetch - The network, injected in tests.
 */
export async function inspectDatabricks(input: { config: Record<string, unknown>; credentials: Record<string, unknown> }, doFetch?: typeof fetch): Promise<ConnectorInspection> {
  const parsed = databricksCredentialsFrom(input.credentials);
  if (!parsed.ok) {
    throw new InspectInputError(parsed.message);
  }
  const cfg = databricksConfigSchema.partial().safeParse(input.config);
  const config = cfg.success ? cfg.data : {};
  if (!config.warehouseId) {
    throw new InspectInputError('Enter the SQL warehouse ID first: Test connection runs on it.');
  }
  const checks: ConnectorCheck[] = [];
  try {
    const wh = await readDatabricksWarehouse(parsed.credentials, config.warehouseId, doFetch);
    checks.push(check('warehouse', 'Token reads the SQL warehouse', true, `${wh.name ?? config.warehouseId}${wh.state ? `, ${wh.state.toLowerCase()}` : ''}.`));
  } catch (err) {
    const status = (err as { status?: number | null }).status ?? null;
    checks.push(check('warehouse', 'Token reads the SQL warehouse', false, (err as Error).message));
    return { reachable: status !== null, authorized: status !== 401 && status !== 403 && status !== null, checks, note: null, error: (err as Error).message };
  }
  const base = { warehouseId: config.warehouseId, ...(config.catalog ? { catalog: config.catalog } : {}), timeoutSeconds: 50, doFetch };
  try {
    await runDatabricksStatement(parsed.credentials, 'SELECT 1', base);
    checks.push(check('query', 'Runs a query', true, null));
  } catch (err) {
    checks.push(check('query', 'Runs a query', false, (err as Error).message));
  }
  const entries = config.schemas && config.catalog ? qualifySchemas(config.schemas, config.catalog) : [];
  for (const entry of entries) {
    const [catalog, schema] = entry.split('.');
    try {
      const res = await runDatabricksStatement(parsed.credentials, `SELECT count(*) FROM \`${catalog!.replaceAll('`', '``')}\`.information_schema.schemata WHERE lower(schema_name) = lower(:schema)`, { ...base, parameters: [{ name: 'schema', value: schema! }] });
      const seen = Number(res.rows[0]?.[0] ?? 0) > 0;
      checks.push(check(`schema:${entry}`, `Sees schema ${entry}`, seen, seen ? null : 'Not visible to this token. Grant USE CATALOG, USE SCHEMA and SELECT, or fix the name.'));
    } catch (err) {
      checks.push(check(`schema:${entry}`, `Sees schema ${entry}`, false, (err as Error).message));
    }
  }
  const failed = checks.filter(c => !c.ok);
  return {
    reachable: true,
    authorized: true,
    checks,
    note: entries.length === 0 ? 'Add the catalog and allowed schemas to check each one.' : 'Only queries run here: anything that writes is refused before it reaches Databricks.',
    error: failed.length > 0 ? failed.map(c => c.detail).filter(Boolean).join(' ') : null,
  };
}

export const databricksConnector: SourceConnector<typeof databricksConfigSchema> = {
  slug: 'databricks',
  name: 'Databricks',
  description: 'Your Databricks SQL warehouse, queried live and read-only: one SELECT at a time over the schemas you allow, with row, size and time limits. Nothing is copied into Vocion.',
  icon: 'Database',
  category: 'data-analytics',
  brand: 'databricks',
  authKind: 'apikey',
  syncless: true,
  configSchema: databricksConfigSchema,
  inspectNote: 'Reads the SQL warehouse and runs a few read-only queries (SELECT 1, which schemas exist). Read-only; it starts a stopped warehouse, which Databricks bills.',

  async inspect({ config, credentials }) {
    return inspectDatabricks({ config, credentials });
  },

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // Read live by the warehouse tools, never mirrored.
  },
};
