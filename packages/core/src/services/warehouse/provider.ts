/**
 * THE WAREHOUSE FAMILY — a SQL warehouse as an agent reads it.
 *
 * "What did Northwind's EMEA accounts spend last quarter" is one SELECT on
 * Snowflake, BigQuery, Databricks or Redshift alike, so the agent has ONE
 * query tool and ONE schema browser (`warehouse_query`, `warehouse_schema`)
 * and this interface is what each vendor fills in. The source a workspace
 * connected decides which provider answers; the agent never names a vendor.
 *
 * Every provider holds its queries to `libs/warehouse/guard.ts`: read-only as
 * the engine itself judges it, the source's schema allowlist checked against
 * what the engine says the statement reads, and the source's row, byte and
 * time limits. Nothing here writes, ever.
 */

import type { FamilySource } from '@/libs/connectors/families';
import type { WarehouseLimits } from '@/libs/warehouse/guard';
import { familySourcesForOrg } from '@/libs/connectors/families';

/** One column of a table, as the warehouse describes it. */
export type WarehouseColumn = { name: string; type: string; nullable: boolean | null; comment: string | null };

/** One table or view in an allowed schema. */
export type WarehouseTableInfo = {
  /** The schema it is in, qualified the way the source's allowlist is. */
  schema: string;
  name: string;
  /** `table`, `view`, or the warehouse's own word for anything else. */
  kind: string;
  comment: string | null;
  /** The warehouse's own row count, when it keeps one. */
  rowCount: number | null;
};

/** What one query handed back. */
export type WarehouseQueryResult = {
  columns: Array<{ name: string; type: string }>;
  /** Positional rows, values as JSON-safe scalars (numbers past 2^53 and decimals as strings). */
  rows: unknown[][];
  /** The rows the full result has, when the warehouse says. */
  totalRows: number | null;
  /** Whether the rows were cut, and by which cap. */
  truncated: 'rows' | 'bytes' | null;
  /** Bytes the warehouse scanned or billed, when it says. */
  bytesScanned: number | null;
  /** The warehouse's id for the statement, for finding it in its own history. */
  queryId: string | null;
};

export type WarehouseProvider = {
  /** The connector kind behind this provider (`snowflake`). */
  kind: string;
  /** The source slug it answers for. */
  sourceSlug: string;
  /** The vendor, as a person knows it: "Snowflake". */
  vendor: string;
  /** What SQL to write: "Snowflake SQL", "GoogleSQL", … */
  dialect: string;
  /**
   * The allowlist, fully qualified the way this warehouse names a schema:
   * `DATABASE.SCHEMA` (Snowflake), `project.dataset` (BigQuery),
   * `catalog.schema` (Databricks), `schema` (Redshift).
   */
  schemas: string[];
  limits: WarehouseLimits;
  /** The tables and views in one allowed schema. */
  listTables: (schema: string) => Promise<WarehouseTableInfo[]>;
  /** One table's columns. */
  describeTable: (schema: string, table: string) => Promise<{ table: WarehouseTableInfo; columns: WarehouseColumn[] }>;
  /**
   * Run one read-only statement under the guard. Throws `WarehouseRefusal`
   * for a statement the guard refused, and an `Error` with the warehouse's
   * own message for one the warehouse refused.
   */
  query: (sql: string, opts: { maxRows: number }) => Promise<WarehouseQueryResult>;
};

/**
 * The provider for a warehouse source, or the workspace's (agent's) only one.
 * @param orgId - The workspace.
 * @param opts - What to resolve by.
 * @param opts.sourceSlug - The source to use, when the caller names one.
 * @param opts.slugs - Only these sources: the agent's own, narrowed by the person's ACL.
 */
export async function warehouseProviderFor(orgId: string, opts: { sourceSlug?: string | null; slugs?: readonly string[] } = {}): Promise<WarehouseProvider> {
  const sources = await familySourcesForOrg(orgId, 'warehouse', opts.slugs);
  if (sources.length === 0) {
    throw new Error('No data warehouse is connected for this agent. Connect one (Snowflake, BigQuery, Databricks or Redshift) at /dashboard/connectors and give this agent the source.');
  }
  let chosen: FamilySource | undefined;
  if (opts.sourceSlug) {
    chosen = sources.find(s => s.slug === opts.sourceSlug);
    if (!chosen) {
      throw new Error(`No warehouse source named ${opts.sourceSlug}. Connected: ${describe(sources)}.`);
    }
  } else if (sources.length > 1) {
    throw new Error(`This agent reads ${sources.length} warehouse sources; name one (source). Connected: ${describe(sources)}.`);
  } else {
    chosen = sources[0]!;
  }
  return providerFor(orgId, chosen);
}

/**
 * Every warehouse source an agent reads, named with its vendor and allowlist.
 * @param orgId - The workspace.
 * @param slugs - The agent's sources.
 */
export async function warehouseSourcesFor(orgId: string, slugs?: readonly string[]): Promise<Array<{ slug: string; kind: string; schemas: string[] }>> {
  const sources = await familySourcesForOrg(orgId, 'warehouse', slugs);
  return sources.map(s => ({ slug: s.slug, kind: s.kind, schemas: schemasOf(s) }));
}

async function providerFor(orgId: string, source: FamilySource): Promise<WarehouseProvider> {
  switch (source.kind) {
    case 'snowflake':
      return (await import('./providers/snowflake')).snowflakeWarehouseProvider(orgId, source);
    case 'bigquery':
      return (await import('./providers/bigquery')).bigqueryWarehouseProvider(orgId, source);
    case 'databricks':
      return (await import('./providers/databricks')).databricksWarehouseProvider(orgId, source);
    case 'redshift':
      return (await import('./providers/redshift')).redshiftWarehouseProvider(orgId, source);
    default:
      throw new Error(`${source.slug} is a ${source.kind} source, which no warehouse provider serves yet.`);
  }
}

function schemasOf(source: FamilySource): string[] {
  const schemas = (source.config as { schemas?: unknown }).schemas;
  return Array.isArray(schemas) ? schemas.map(String) : [];
}

function describe(sources: FamilySource[]): string {
  return sources.map(s => `${s.slug} (${s.kind}: ${schemasOf(s).join(', ') || 'no schemas'})`).join('; ');
}
