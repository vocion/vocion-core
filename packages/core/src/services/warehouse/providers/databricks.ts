/**
 * DATABRICKS — a provider of the warehouse family (`../provider.ts`).
 *
 * A query runs in three steps, each one the engine's word rather than ours:
 *
 *   1. `EXPLAIN EXTENDED` over the statement wrapped as a subquery
 *      (`asSubquery`). EXPLAIN plans without running, and Spark SQL's grammar
 *      refuses anything but a query after `FROM (`, so DDL, DML and a second
 *      statement fail here and are refused. A plan that could not be
 *      analysed (Databricks answers "Error occurred during query planning")
 *      is refused the same way.
 *   2. The analysed logical plan names every relation and view it reads,
 *      qualified by catalog and schema; each is held to the source's
 *      allowlist. A relation line the guard cannot qualify is refused (fail
 *      closed), so a source it does not recognise never reads past the list.
 *   3. The statement runs as written — the Statement Execution API takes one
 *      statement only — with `row_limit` one past the row cap, `byte_limit`
 *      at the byte cap, and a cancel at the source's timeout.
 */

import type { WarehouseColumn, WarehouseProvider, WarehouseQueryResult, WarehouseTableInfo } from '../provider';
import type { FamilySource } from '@/libs/connectors/families';
import type { DatabricksCredentials } from '@/libs/databricks/client';
import type { ReferencedObject } from '@/libs/warehouse/guard';
import { databricksCredentialsFrom, DatabricksError, databricksValue, runDatabricksStatement } from '@/libs/databricks/client';
import { databricksConfigSchema } from '@/libs/sources/databricks';
import { assertSchemaAllowed, asSubquery, capRows, limitsFrom, qualifySchemas, refuseOutsideAllowlist, runnableSql, schemaKey, WarehouseRefusal } from '@/libs/warehouse/guard';
import { familySourceCredentials, noCredentialMessage } from '@/services/connectors/familyCredentials';

const VENDOR = 'Databricks';

/** A plan line that reads a relation: Spark prints these node names for tables and views. */
const RELATION_NODE = /\b(?:Relation|RelationV2|HiveTableRelation|DataSourceV2Relation|LogicalRDD|View)\b/;
/** A dotted name of two or three parts, each bare or back-quoted. */
const QUALIFIED_NAME = /(?:`(?:[^`]|``)+`|[A-Z_][\w-]*)(?:\.(?:`(?:[^`]|``)+`|[A-Z_][\w-]*)){1,2}/i;

function unquote(part: string): string {
  return part.startsWith('`') ? part.slice(1, -1).replaceAll('``', '`') : part;
}

function splitName(name: string): string[] {
  return (name.match(/`(?:[^`]|``)+`|[^.]+/g) ?? []).map(unquote);
}

/**
 * The relations an `EXPLAIN EXTENDED` plan reads, from its analysed logical
 * plan, qualified by catalog (a two-part name is in `defaultCatalog`).
 * Throws a refusal when planning failed, or when a relation line names no
 * table the guard can qualify.
 * @param planText - The plan Databricks returned.
 * @param defaultCatalog - The source's catalog.
 */
export function databricksPlanObjects(planText: string, defaultCatalog: string): ReferencedObject[] {
  if (/Error occurred during query planning/i.test(planText)) {
    const reason = planText.split('Error occurred during query planning').pop()!.replace(/^[\s:]+/, '').split('\n')[0]?.trim();
    throw new WarehouseRefusal(`Only one read-only query (SELECT, or WITH … SELECT) runs here, and Databricks could not plan this one${reason ? `: ${reason}` : '.'}`);
  }
  const analysed = /== Analyzed Logical Plan ==([\s\S]*?)(?:== Optimized Logical Plan ==|$)/.exec(planText)?.[1];
  if (analysed === undefined) {
    throw new WarehouseRefusal('Databricks returned a plan this guard cannot read, so the query was not run.');
  }
  const out: ReferencedObject[] = [];
  for (const line of analysed.split('\n')) {
    const node = RELATION_NODE.exec(line);
    if (!node) {
      continue;
    }
    const name = QUALIFIED_NAME.exec(line.slice(node.index + node[0].length))?.[0];
    if (!name) {
      throw new WarehouseRefusal(`Databricks's plan reads a ${node[0]} that names no table (a path or an inline source), so which schema it reads cannot be checked. The query was not run.`);
    }
    const parts = splitName(name);
    const [catalog, schema, table] = parts.length === 3 ? parts : [defaultCatalog, parts[0]!, parts[1]!];
    out.push({ schema: `${catalog}.${schema}`, name: table! });
  }
  return out;
}

/**
 * The provider for one Databricks source.
 * @param orgId - The workspace.
 * @param source - The source row.
 */
export async function databricksWarehouseProvider(orgId: string, source: FamilySource): Promise<WarehouseProvider> {
  const config = databricksConfigSchema.parse(source.config);
  const bag = await familySourceCredentials(orgId, source);
  if (!bag) {
    throw new Error(noCredentialMessage(source, VENDOR));
  }
  const parsed = databricksCredentialsFrom(bag);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  return buildDatabricksProvider(source.slug, parsed.credentials, config);
}

/**
 * A name as Spark SQL, back-quoted. Only ever an allowlist entry an admin
 * typed, never the agent's text.
 * @param name - A catalog name.
 */
function quoted(name: string): string {
  return `\`${name.replaceAll('`', '``')}\``;
}

/**
 * The provider over a resolved credential and config. Split out for tests.
 * @param sourceSlug - The source.
 * @param credentials - The credential.
 * @param config - The parsed config.
 */
export function buildDatabricksProvider(sourceSlug: string, credentials: DatabricksCredentials, config: ReturnType<typeof databricksConfigSchema.parse>): WarehouseProvider {
  const schemas = qualifySchemas(config.schemas, config.catalog);
  const limits = limitsFrom(config);
  const run = (sql: string, extra: { rowLimit?: number; byteLimit?: number; parameters?: Array<{ name: string; value: string }> } = {}) =>
    runDatabricksStatement(credentials, sql, { warehouseId: config.warehouseId, catalog: config.catalog, timeoutSeconds: limits.timeoutSeconds, ...extra });
  const allowedEntry = (typed: string) => {
    const schema = qualifySchemas([typed], config.catalog)[0] ?? typed;
    assertSchemaAllowed(schema, schemas, VENDOR);
    return schemas.find(s => schemaKey(s) === schemaKey(schema)) ?? schema;
  };

  const listTables = async (schema: string): Promise<WarehouseTableInfo[]> => {
    const entry = allowedEntry(schema);
    const [catalog, schemaName] = splitName(entry);
    const res = await run(
      `SELECT table_name, table_type, comment FROM ${quoted(catalog!)}.information_schema.tables WHERE lower(table_schema) = lower(:schema) ORDER BY table_name LIMIT 1000`,
      { parameters: [{ name: 'schema', value: schemaName! }] },
    );
    return res.rows.map(r => ({ schema: entry, name: r[0] ?? '', kind: (r[1] ?? '').toUpperCase().includes('VIEW') ? 'view' : (r[1] ?? '').toLowerCase() === 'managed' || (r[1] ?? '').toLowerCase() === 'external' || (r[1] ?? '').toUpperCase() === 'BASE TABLE' ? 'table' : (r[1] ?? '').toLowerCase(), comment: r[2] ?? null, rowCount: null }));
  };

  return {
    kind: 'databricks',
    sourceSlug,
    vendor: VENDOR,
    dialect: 'Databricks SQL',
    schemas,
    limits,
    listTables,
    async describeTable(schema, table) {
      const entry = allowedEntry(schema);
      const [catalog, schemaName] = splitName(entry);
      const info = (await listTables(entry)).find(t => t.name.toLowerCase() === table.toLowerCase());
      if (!info) {
        throw new Error(`No table or view named ${table} in ${entry} that this token can see.`);
      }
      const res = await run(
        `SELECT column_name, full_data_type, is_nullable, comment FROM ${quoted(catalog!)}.information_schema.columns WHERE lower(table_schema) = lower(:schema) AND table_name = :tbl ORDER BY ordinal_position`,
        { parameters: [{ name: 'schema', value: schemaName! }, { name: 'tbl', value: info.name }] },
      );
      const columns: WarehouseColumn[] = res.rows.map(r => ({ name: r[0] ?? '', type: r[1] ?? '', nullable: r[2] === null ? null : r[2] === 'YES', comment: r[3] ?? null }));
      return { table: info, columns };
    },
    async query(sql, opts): Promise<WarehouseQueryResult> {
      let planText: string;
      try {
        const explained = await run(`EXPLAIN EXTENDED ${asSubquery(sql)}`);
        planText = explained.rows.map(r => r[0] ?? '').join('\n');
      } catch (err) {
        if (err instanceof DatabricksError && err.status === null && err.code !== null) {
          throw new WarehouseRefusal(`Only one read-only query (SELECT, or WITH … SELECT) runs here, and Databricks would not plan this as one. ${err.message}`);
        }
        throw err;
      }
      refuseOutsideAllowlist({ vendor: VENDOR, referenced: databricksPlanObjects(planText, config.catalog), allowed: schemas });
      const maxRows = Math.min(opts.maxRows, limits.maxRows);
      const res = await run(runnableSql(sql), { rowLimit: maxRows + 1, byteLimit: limits.maxResultBytes });
      const values = res.rows.map(row => row.map((cell, i) => databricksValue(cell, res.columns[i])));
      const capped = capRows(values, { maxRows, maxResultBytes: limits.maxResultBytes });
      return {
        columns: res.columns,
        rows: capped.rows,
        totalRows: res.truncated ? null : res.totalRows,
        truncated: capped.truncated ?? (res.truncated ? 'bytes' : null),
        bytesScanned: null,
        queryId: res.statementId,
      };
    },
  };
}
