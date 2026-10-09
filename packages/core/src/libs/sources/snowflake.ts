/**
 * Snowflake connector — the capability carrier for the warehouse tools on
 * Snowflake, and nothing else.
 *
 * A warehouse is queried LIVE (`warehouse_query`, `warehouse_schema`): rows
 * mirrored into the index would be stale the moment they were written and
 * would copy data the warehouse already governs. So this connector ingests
 * nothing, the way Sentry's does not. What registering it buys is the tile,
 * the key pair in the encrypted vault, the source an agent carries in its
 * `connectorSources`, its schema allowlist and limits — and Test connection.
 *
 * Auth: key-pair (a user and its RSA private key, `snowflake` platform),
 * signing a short-lived JWT per call for the SQL API.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { SnowflakeContext } from '@/libs/snowflake/client';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { runSnowflakeStatement, snowflakeCredentialsFrom, snowflakeIdentifier } from '@/libs/snowflake/client';
import { warehouseConfigShape } from '@/libs/warehouse/config';
import { qualifySchemas } from '@/libs/warehouse/guard';
import { InspectInputError } from './inspect';

export const snowflakeConfigSchema = z.object({
  /** The virtual warehouse that runs the queries (compute), e.g. ANALYST_XS. */
  warehouse: z.string().min(1),
  /** The database an allowlist entry without one is in, e.g. ANALYTICS. */
  database: z.string().min(1),
  /** The role to query as. Blank: the user's default role, which should be a read-only one. */
  role: z.string().min(1).optional(),
  ...warehouseConfigShape,
});

function check(key: string, label: string, ok: boolean, detail: string | null): ConnectorCheck {
  return { key, label, ok, detail };
}

/**
 * Test connection: who the key pair signs in as, with which role and
 * warehouse, and whether each allowed schema is there for that role. Every
 * read is a query; nothing is saved.
 * @param input - Config and credential, as typed or as vaulted.
 * @param input.config - The source config, possibly partial.
 * @param input.credentials - The credential values.
 * @param doFetch - The network, injected in tests.
 */
export async function inspectSnowflake(input: { config: Record<string, unknown>; credentials: Record<string, unknown> }, doFetch?: typeof fetch): Promise<ConnectorInspection> {
  const parsed = snowflakeCredentialsFrom(input.credentials);
  if (!parsed.ok) {
    throw new InspectInputError(parsed.message);
  }
  const cfg = snowflakeConfigSchema.partial().safeParse(input.config);
  const config = cfg.success ? cfg.data : {};
  const context: SnowflakeContext = {
    ...(config.warehouse ? { warehouse: config.warehouse } : {}),
    ...(config.database ? { database: config.database } : {}),
    ...(config.role ? { role: config.role } : {}),
  };
  const checks: ConnectorCheck[] = [];
  let who: Array<string | null>;
  try {
    const res = await runSnowflakeStatement(parsed.credentials, 'SELECT CURRENT_USER(), CURRENT_ROLE(), CURRENT_WAREHOUSE()', { context, timeoutSeconds: 30, doFetch });
    who = res.rows[0] ?? [];
  } catch (err) {
    const message = (err as Error).message;
    const status = (err as { status?: number | null }).status ?? null;
    checks.push(check('auth', 'Key pair signs in', false, message));
    return { reachable: status !== null, authorized: false, checks, note: null, error: message };
  }
  checks.push(check('auth', 'Key pair signs in', true, `Signed in as ${who[0] ?? parsed.credentials.user}, role ${who[1] ?? 'none'}.`));
  checks.push(check('warehouse', 'A warehouse runs the queries', Boolean(who[2]), who[2] ? `Warehouse ${who[2]}.` : 'No warehouse is in use. Name one on the source (and grant the role USAGE on it).'));

  const entries = config.schemas && config.database ? qualifySchemas(config.schemas, config.database) : [];
  for (const entry of entries) {
    const [database, schema] = entry.split('.');
    try {
      const res = await runSnowflakeStatement(parsed.credentials, 'SELECT COUNT(*) FROM IDENTIFIER(?) WHERE UPPER(SCHEMA_NAME) = UPPER(?)', { context, timeoutSeconds: 30, bindings: [`${snowflakeIdentifier(database!)}.INFORMATION_SCHEMA.SCHEMATA`, schema!], doFetch });
      const seen = Number(res.rows[0]?.[0] ?? 0) > 0;
      checks.push(check(`schema:${entry}`, `Sees schema ${entry}`, seen, seen ? null : 'Not visible to this role. Grant it USAGE on the database and schema, or fix the name.'));
    } catch (err) {
      checks.push(check(`schema:${entry}`, `Sees schema ${entry}`, false, (err as Error).message));
    }
  }
  const failed = checks.filter(c => !c.ok);
  return {
    reachable: true,
    authorized: true,
    checks,
    note: entries.length === 0 ? 'Add the allowed schemas to check each one.' : 'Only queries run here: anything that writes is refused before it reaches Snowflake.',
    error: failed.length > 0 ? failed.map(c => c.detail).filter(Boolean).join(' ') : null,
  };
}

export const snowflakeConnector: SourceConnector<typeof snowflakeConfigSchema> = {
  slug: 'snowflake',
  name: 'Snowflake',
  description: 'Your Snowflake warehouse, queried live and read-only: one SELECT at a time over the schemas you allow, with row, size and time limits. Nothing is copied into Vocion.',
  icon: 'Database',
  category: 'data-analytics',
  brand: 'snowflake',
  authKind: 'apikey',
  syncless: true,
  configSchema: snowflakeConfigSchema,
  inspectNote: 'Signs in with the key pair and runs a few read-only queries (who am I, which schemas exist). Read-only; it wakes the warehouse for a moment, which Snowflake bills.',

  async inspect({ config, credentials }) {
    return inspectSnowflake({ config, credentials });
  },

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // Read live by the warehouse tools, never mirrored.
  },
};
