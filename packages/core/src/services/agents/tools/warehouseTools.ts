/**
 * The warehouse family's reads — one SQL tool and one schema browser for
 * Snowflake, BigQuery, Databricks and Redshift alike.
 *
 *   warehouse_schema  what this agent may read: the sources and their allowed
 *                     schemas, the tables in one schema, one table's columns.
 *   warehouse_query   one read-only SQL statement, run live, rows back.
 *
 * Present for any agent whose `connectorSources` include a warehouse source
 * (`familyInScope`), and only over those sources (narrowed by the person's
 * source ACL). The provider is the source's (`services/warehouse/provider.ts`);
 * every query goes through `libs/warehouse/guard.ts` — read-only as the
 * engine judges it, the source's schema allowlist, its row, byte and time
 * limits. There is no write: a warehouse is read here and nowhere written.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { familyInScope, familySourceSlugs } from '@/libs/connectors/families';

export const WAREHOUSE_QUERY_TOOL = 'warehouse_query';
export const WAREHOUSE_SCHEMA_TOOL = 'warehouse_schema';

/** Rows the agent sees when it asks for no number: enough to answer, not a dump. */
const DEFAULT_ROWS = 100;

export function warehouseTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!familyInScope(ctx, 'warehouse')) {
    return [];
  }
  return [schemaTool(ctx), queryTool(ctx)];
}

/**
 * The tool's answer to a failure: a refusal by the guard says so, so the
 * agent rewrites the query rather than retrying it.
 * @param err - What was thrown.
 */
function failure(err: unknown): string {
  const refused = err instanceof Error && err.name === 'WarehouseRefusal';
  return JSON.stringify({ ok: false, ...(refused ? { refused: true } : {}), error: err instanceof Error ? err.message : String(err) });
}

function schemaTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const slugs = familySourceSlugs(ctx, 'warehouse');
        const { warehouseProviderFor, warehouseSourcesFor } = await import('@/services/warehouse/provider');
        if (!args.schema) {
          const sources = await warehouseSourcesFor(ctx.orgId, slugs);
          if (sources.length !== 1 && !args.source) {
            return JSON.stringify({ ok: true, sources, note: 'Name a source and a schema to list its tables.' });
          }
          const provider = await warehouseProviderFor(ctx.orgId, { sourceSlug: args.source ?? null, slugs });
          return JSON.stringify({
            ok: true,
            source: provider.sourceSlug,
            warehouse: provider.vendor,
            dialect: provider.dialect,
            schemas: provider.schemas,
            limits: { maxRows: provider.limits.maxRows, timeoutSeconds: provider.limits.timeoutSeconds },
            note: 'These are the only schemas a query may read. Name one to list its tables.',
          });
        }
        const { assertSchemaAllowed } = await import('@/libs/warehouse/guard');
        const provider = await warehouseProviderFor(ctx.orgId, { sourceSlug: args.source ?? null, slugs });
        const schema = qualified(args.schema, provider.schemas);
        assertSchemaAllowed(schema, provider.schemas, provider.vendor);
        if (args.table) {
          const described = await provider.describeTable(schema, args.table);
          return JSON.stringify({ ok: true, source: provider.sourceSlug, warehouse: provider.vendor, ...described });
        }
        const tables = await provider.listTables(schema);
        return JSON.stringify({ ok: true, source: provider.sourceSlug, warehouse: provider.vendor, schema, count: tables.length, tables, note: tables.length === 0 ? 'No table or view this credential can see in that schema.' : 'Name a table to read its columns.' });
      } catch (err) {
        return failure(err);
      }
    },
    {
      name: WAREHOUSE_SCHEMA_TOOL,
      description: 'Browse the connected data warehouse (Snowflake, BigQuery, Databricks or Redshift — whichever this workspace connected): with nothing, the allowed schemas, the SQL dialect and the limits; with a schema, its tables and views (row counts and comments where kept); with a schema and a table, its columns and types. Use it before warehouse_query so the SQL names real tables and columns.',
      schema: z.object({
        schema: z.string().max(300).optional().describe('An allowed schema (a dataset on BigQuery), as warehouse_schema listed it.'),
        table: z.string().max(300).optional().describe('With schema: a table or view to describe.'),
        source: z.string().optional().describe('The warehouse source, when this agent reads more than one.'),
      }),
    },
  );
}

/**
 * A schema as typed, qualified like the allowlist when it matches the last
 * part of exactly one entry (`marts` → `ANALYTICS.MARTS`).
 * @param schema - The schema the agent named.
 * @param allowed - The provider's qualified allowlist.
 */
function qualified(schema: string, allowed: readonly string[]): string {
  if (schema.includes('.')) {
    return schema;
  }
  const matches = allowed.filter(entry => entry.split('.').pop()!.toLowerCase() === schema.toLowerCase());
  return matches.length === 1 ? matches[0]! : schema;
}

function queryTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const { warehouseProviderFor } = await import('@/services/warehouse/provider');
        const provider = await warehouseProviderFor(ctx.orgId, { sourceSlug: args.source ?? null, slugs: familySourceSlugs(ctx, 'warehouse') });
        const maxRows = Math.min(args.max_rows ?? DEFAULT_ROWS, provider.limits.maxRows);
        const result = await provider.query(args.sql, { maxRows });
        return JSON.stringify({
          ok: true,
          source: provider.sourceSlug,
          warehouse: provider.vendor,
          columns: result.columns,
          rows: result.rows,
          rowCount: result.rows.length,
          totalRows: result.totalRows,
          truncated: result.truncated,
          bytesScanned: result.bytesScanned,
          queryId: result.queryId,
          note: result.truncated === 'rows'
            ? `Cut at ${result.rows.length} rows${result.totalRows !== null ? ` of ${result.totalRows}` : ''}. Aggregate in SQL (GROUP BY, COUNT, SUM) rather than reading more rows.`
            : result.truncated === 'bytes'
              ? `Cut at ${result.rows.length} rows by the size cap. Select fewer or narrower columns, or aggregate in SQL.`
              : 'Every row of the result is here. Cite the query (its queryId) beside any number taken from it.',
        });
      } catch (err) {
        return failure(err);
      }
    },
    {
      name: WAREHOUSE_QUERY_TOOL,
      description: 'Run ONE read-only SQL query on the connected data warehouse (Snowflake, BigQuery, Databricks or Redshift) and get the rows back. Only SELECT (or WITH … SELECT) runs: the warehouse itself refuses anything that writes, and a query that reads outside the source\'s allowed schemas is refused before it runs. Write the warehouse\'s own dialect (warehouse_schema says which), qualify tables with their schema, and aggregate in SQL — results stop at the source\'s row, size and time limits.',
      schema: z.object({
        sql: z.string().min(1).max(50_000).describe('One SELECT statement in the warehouse\'s dialect, tables qualified by schema.'),
        max_rows: z.number().int().min(1).max(10_000).optional().describe(`Rows to hand back (default ${DEFAULT_ROWS}, never more than the source's cap).`),
        source: z.string().optional().describe('The warehouse source, when this agent reads more than one.'),
      }),
    },
  );
}
