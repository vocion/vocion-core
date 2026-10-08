/**
 * SNOWFLAKE — a provider of the warehouse family (`../provider.ts`).
 *
 * A query runs in three steps, each one the engine's word rather than ours:
 *
 *   1. `EXPLAIN USING JSON` over the statement wrapped as a subquery
 *      (`asSubquery`). EXPLAIN compiles without running, and Snowflake's
 *      grammar refuses anything but a query after `FROM (`, so DDL, DML,
 *      CALL and a second statement fail here and are refused.
 *   2. The plan's scan operations name the objects they read
 *      (`"objects": ["DB.SCHEMA.TABLE"]`); every one is held to the source's
 *      allowlist, and a scan that names nothing is refused (fail closed).
 *   3. The statement runs as written with `MULTI_STATEMENT_COUNT=1`, the
 *      source's `timeout` (Snowflake cancels it past that) and
 *      `ROWS_PER_RESULTSET` one past the row cap; `capRows` cuts the rest.
 */

import type { WarehouseColumn, WarehouseProvider, WarehouseQueryResult, WarehouseTableInfo } from '../provider';
import type { FamilySource } from '@/libs/connectors/families';
import type { SnowflakeColumn, SnowflakeContext, SnowflakeCredentials } from '@/libs/snowflake/client';
import type { ReferencedObject } from '@/libs/warehouse/guard';
import { runSnowflakeStatement, snowflakeCredentialsFrom, snowflakeIdentifier, snowflakeValue } from '@/libs/snowflake/client';
import { snowflakeConfigSchema } from '@/libs/sources/snowflake';
import { assertSchemaAllowed, asSubquery, capRows, limitsFrom, qualifySchemas, refuseOutsideAllowlist, runnableSql, schemaKey, WarehouseRefusal } from '@/libs/warehouse/guard';
import { familySourceCredentials, noCredentialMessage } from '@/services/connectors/familyCredentials';

const VENDOR = 'Snowflake';

type PlanOperation = { operation?: string; objects?: unknown };

/**
 * The objects a compiled plan reads, from `EXPLAIN USING JSON` output.
 * Throws a refusal when a scan names no object, since its schema cannot be judged.
 * @param planText - The JSON EXPLAIN returned.
 */
export function snowflakePlanObjects(planText: string): ReferencedObject[] {
  let plan: { Operations?: PlanOperation[][] };
  try {
    plan = JSON.parse(planText) as typeof plan;
  } catch {
    throw new WarehouseRefusal('Snowflake returned a plan this guard cannot read, so the query was not run.');
  }
  const out: ReferencedObject[] = [];
  for (const op of (plan.Operations ?? []).flat()) {
    const objects = Array.isArray(op.objects) ? op.objects.map(String) : [];
    if (objects.length === 0 && /scan$/i.test(op.operation ?? '')) {
      throw new WarehouseRefusal(`Snowflake's plan has a ${op.operation} that names no table, so which schema it reads cannot be checked. The query was not run.`);
    }
    for (const qualified of objects) {
      const parts = splitIdentifier(qualified);
      if (parts.length < 3) {
        throw new WarehouseRefusal(`Snowflake's plan reads ${qualified}, which is not qualified by database and schema, so it cannot be checked. The query was not run.`);
      }
      out.push({ schema: `${parts[0]}.${parts[1]}`, name: parts.slice(2).join('.') });
    }
  }
  return out;
}

/**
 * A dotted identifier split into its parts, double-quoted parts kept whole.
 * @param identifier - `DB.SCHEMA.TABLE` or `"Db"."Schema".T`.
 */
function splitIdentifier(identifier: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  for (const ch of identifier) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === '.' && !quoted) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.filter(p => p.length > 0);
}

/**
 * The provider for one Snowflake source.
 * @param orgId - The workspace.
 * @param source - The source row.
 */
export async function snowflakeWarehouseProvider(orgId: string, source: FamilySource): Promise<WarehouseProvider> {
  const config = snowflakeConfigSchema.parse(source.config);
  const bag = await familySourceCredentials(orgId, source);
  if (!bag) {
    throw new Error(noCredentialMessage(source, VENDOR));
  }
  const parsed = snowflakeCredentialsFrom(bag);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  return buildSnowflakeProvider(source.slug, parsed.credentials, config);
}

/**
 * The provider over a resolved credential and config. Split out for tests.
 * @param sourceSlug - The source.
 * @param credentials - The credential.
 * @param config - The parsed config.
 */
export function buildSnowflakeProvider(sourceSlug: string, credentials: SnowflakeCredentials, config: ReturnType<typeof snowflakeConfigSchema.parse>): WarehouseProvider {
  const schemas = qualifySchemas(config.schemas, config.database);
  const limits = limitsFrom(config);
  const context: SnowflakeContext = { warehouse: config.warehouse, database: config.database, ...(config.role ? { role: config.role } : {}) };
  const run = (sql: string, extra: { maxRows?: number; bindings?: string[] } = {}) => runSnowflakeStatement(credentials, sql, { context, timeoutSeconds: limits.timeoutSeconds, ...extra });
  const allowedEntry = (typed: string) => {
    const schema = qualifySchemas([typed], config.database)[0] ?? typed;
    assertSchemaAllowed(schema, schemas, VENDOR);
    return schemas.find(s => schemaKey(s) === schemaKey(schema)) ?? schema;
  };

  const listTables = async (schema: string): Promise<WarehouseTableInfo[]> => {
    const entry = allowedEntry(schema);
    const [database, schemaName] = splitIdentifier(entry);
    const res = await run(
      'SELECT TABLE_NAME, TABLE_TYPE, COMMENT, ROW_COUNT FROM IDENTIFIER(?) WHERE UPPER(TABLE_SCHEMA) = UPPER(?) ORDER BY TABLE_NAME LIMIT 1000',
      { bindings: [`${snowflakeIdentifier(database!)}.INFORMATION_SCHEMA.TABLES`, schemaName!] },
    );
    return res.rows.map(r => ({ schema: entry, name: r[0] ?? '', kind: (r[1] ?? '').toUpperCase().includes('VIEW') ? 'view' : (r[1] ?? '').toUpperCase() === 'BASE TABLE' ? 'table' : (r[1] ?? '').toLowerCase(), comment: r[2] ?? null, rowCount: r[3] !== null && r[3] !== undefined ? Number(r[3]) : null }));
  };

  return {
    kind: 'snowflake',
    sourceSlug,
    vendor: VENDOR,
    dialect: 'Snowflake SQL',
    schemas,
    limits,
    listTables,
    async describeTable(schema, table) {
      const entry = allowedEntry(schema);
      const [database, schemaName] = splitIdentifier(entry);
      const tables = await listTables(entry);
      const info = tables.find(t => t.name.toLowerCase() === table.toLowerCase());
      if (!info) {
        throw new Error(`No table or view named ${table} in ${entry} that this role can see.`);
      }
      const res = await run(
        'SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COMMENT FROM IDENTIFIER(?) WHERE UPPER(TABLE_SCHEMA) = UPPER(?) AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
        { bindings: [`${snowflakeIdentifier(database!)}.INFORMATION_SCHEMA.COLUMNS`, schemaName!, info.name] },
      );
      const columns: WarehouseColumn[] = res.rows.map(r => ({ name: r[0] ?? '', type: r[1] ?? '', nullable: r[2] === null ? null : r[2] === 'YES', comment: r[3] ?? null }));
      return { table: info, columns };
    },
    async query(sql, opts): Promise<WarehouseQueryResult> {
      let planText: string;
      try {
        const explained = await run(`EXPLAIN USING JSON ${asSubquery(sql)}`);
        planText = explained.rows[0]?.[0] ?? '';
      } catch (err) {
        if ((err as { status?: number | null }).status === 422 || /SQL compilation error|syntax error/i.test((err as Error).message)) {
          throw new WarehouseRefusal(`Only one read-only query (SELECT, or WITH … SELECT) runs here, and Snowflake would not compile this as one. ${(err as Error).message}`);
        }
        throw err;
      }
      refuseOutsideAllowlist({ vendor: VENDOR, referenced: snowflakePlanObjects(planText), allowed: schemas });
      const maxRows = Math.min(opts.maxRows, limits.maxRows);
      const res = await run(runnableSql(sql), { maxRows });
      const values = res.rows.map(row => row.map((cell, i) => snowflakeValue(cell, res.columns[i] as SnowflakeColumn | undefined)));
      const capped = capRows(values, { maxRows, maxResultBytes: limits.maxResultBytes });
      return {
        columns: res.columns.map(c => ({ name: c.name, type: c.type })),
        rows: capped.rows,
        totalRows: capped.truncated === 'rows' && res.numRows !== null && res.numRows <= maxRows + 1 ? null : res.numRows,
        truncated: capped.truncated,
        bytesScanned: null,
        queryId: res.handle,
      };
    },
  };
}
