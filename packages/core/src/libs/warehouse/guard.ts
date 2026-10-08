/**
 * THE WAREHOUSE GUARD — what every warehouse provider holds a query to,
 * whichever vendor runs it.
 *
 * Three walls, and none of them reads the agent's SQL with a pattern:
 *
 *   1. **Read-only, enforced by the engine.** Each provider proves a statement
 *      is a query with the engine's own parser or planner before it runs —
 *      BigQuery's dry run reports the statement type, Snowflake and Databricks
 *      compile it as a subquery (`asSubquery`), which their grammar refuses
 *      for anything but a query, and Redshift runs it inside a `READ ONLY`
 *      transaction. Multi-statement text is refused by the driver
 *      (`MULTI_STATEMENT_COUNT=1`, the Statement Execution API's single
 *      statement, the subquery wrapper). The warehouse credential's own
 *      grants are the wall underneath all of it: the connector docs say to
 *      use a role that can only read.
 *   2. **The source's schema allowlist**, checked against the objects the
 *      ENGINE says the statement reads (dry-run referenced tables, the
 *      compiled plan's scanned objects) — `refuseOutsideAllowlist`. A query
 *      that reads anything outside it never runs.
 *   3. **Limits**: a statement timeout the engine enforces, a row cap and a
 *      byte cap on what comes back (`capRows`), and on BigQuery a cap on
 *      bytes billed.
 *
 * A refusal is a `WarehouseRefusal`, whose message is written for the agent
 * and the person reading over its shoulder: what was refused and why, never
 * a credential.
 */

/** A query the guard refused, with the sentence to show for it. */
export class WarehouseRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WarehouseRefusal';
  }
}

/** The limits a source sets on what one query may cost and return. */
export type WarehouseLimits = {
  /** The most rows one query hands back. */
  maxRows: number;
  /** The most bytes of row data (as JSON) one query hands back. */
  maxResultBytes: number;
  /** How long the engine may run one statement before it cancels it. */
  timeoutSeconds: number;
};

/** The defaults a source gets when it sets nothing. */
export const DEFAULT_WAREHOUSE_LIMITS: WarehouseLimits = { maxRows: 1000, maxResultBytes: 2_000_000, timeoutSeconds: 60 };

/**
 * The source's limits, from its parsed config.
 * @param config - The config, as the connector's schema parsed it.
 * @param config.maxRows - Row cap.
 * @param config.maxResultKb - Byte cap, in kilobytes.
 * @param config.timeoutSeconds - Statement timeout.
 */
export function limitsFrom(config: { maxRows?: number; maxResultKb?: number; timeoutSeconds?: number }): WarehouseLimits {
  return {
    maxRows: config.maxRows ?? DEFAULT_WAREHOUSE_LIMITS.maxRows,
    maxResultBytes: config.maxResultKb ? config.maxResultKb * 1000 : DEFAULT_WAREHOUSE_LIMITS.maxResultBytes,
    timeoutSeconds: config.timeoutSeconds ?? DEFAULT_WAREHOUSE_LIMITS.timeoutSeconds,
  };
}

/**
 * The agent's statement as a subquery, so that the engine's own grammar
 * refuses anything but a query: `INSERT`, `DELETE`, `CREATE`, `GRANT`, `CALL`
 * and a second statement are all syntax errors after `FROM (`. Used to COMPILE
 * a statement (EXPLAIN) before it runs; the statement itself then runs as
 * written, so an `ORDER BY` keeps its order. A trailing semicolon is the one
 * thing taken off, since a person often types one.
 * @param sql - The statement as the agent wrote it.
 */
export function asSubquery(sql: string): string {
  const body = sql.trim().replace(/;+\s*$/, '');
  return `SELECT * FROM (\n${body}\n) AS vocion_query`;
}

/**
 * The statement as it runs: trimmed, one trailing semicolon taken off. A
 * second statement is left in place for the driver to refuse.
 * @param sql - The statement as the agent wrote it.
 */
export function runnableSql(sql: string): string {
  return sql.trim().replace(/;+\s*$/, '');
}

/**
 * The allowlist entries qualified with the source's default namespace (the
 * Snowflake database, the BigQuery project, the Databricks catalog), so an
 * entry typed as `marts` and an engine reference to `ANALYTICS.MARTS` compare.
 * Entries that already name their namespace are kept.
 * @param entries - The source's `schemas`, as typed.
 * @param defaultNamespace - The namespace an unqualified entry lives in, or null when the warehouse has none above a schema.
 */
export function qualifySchemas(entries: readonly string[], defaultNamespace: string | null): string[] {
  return [...new Set(entries.map(e => e.trim()).filter(Boolean).map(e => (e.includes('.') || !defaultNamespace ? e : `${defaultNamespace}.${e}`)))];
}

/**
 * How two schema names compare: unquoted, case-folded. Warehouses fold
 * unquoted identifiers to one case (Snowflake up, Redshift and Databricks
 * down), and an allowlist typed in either case should match.
 * @param name - A schema name, qualified or not.
 */
export function schemaKey(name: string): string {
  return name.split('.').map(part => part.trim().replace(/^[`"[]|[`"\]]$/g, '').toLowerCase()).join('.');
}

/**
 * Whether a schema is in the allowlist.
 * @param schema - The schema, qualified the way the allowlist is.
 * @param allowed - The source's qualified allowlist.
 */
export function schemaAllowed(schema: string, allowed: readonly string[]): boolean {
  const key = schemaKey(schema);
  return allowed.some(entry => schemaKey(entry) === key);
}

/**
 * Refuse a browse of a schema outside the allowlist.
 * @param schema - The schema asked for.
 * @param allowed - The source's qualified allowlist.
 * @param vendor - The warehouse, for the sentence.
 */
export function assertSchemaAllowed(schema: string, allowed: readonly string[], vendor: string): void {
  if (!schemaAllowed(schema, allowed)) {
    throw new WarehouseRefusal(`${schema} is not one of the schemas this ${vendor} source allows (${allowed.join(', ')}). A schema is added on the source, not here.`);
  }
}

/** One object the engine says a statement reads, with the schema it is in. */
export type ReferencedObject = { schema: string; name: string };

/**
 * Refuse a statement that reads anything outside the allowlist, judged by
 * the objects the ENGINE reported for it — never by reading the SQL.
 * @param input - What the engine reported and what the source allows.
 * @param input.vendor - The warehouse, for the sentence.
 * @param input.referenced - The objects the engine says the statement reads.
 * @param input.allowed - The source's qualified allowlist.
 */
export function refuseOutsideAllowlist(input: { vendor: string; referenced: readonly ReferencedObject[]; allowed: readonly string[] }): void {
  const outside = input.referenced.filter(ref => !schemaAllowed(ref.schema, input.allowed));
  if (outside.length === 0) {
    return;
  }
  const names = [...new Set(outside.map(ref => `${ref.schema}.${ref.name}`))];
  throw new WarehouseRefusal(`This query reads ${names.join(', ')}, outside the schemas this ${input.vendor} source allows (${input.allowed.join(', ')}). It was not run. Query only those schemas; a schema is added on the source, not here.`);
}

/**
 * The rows a query hands back, cut at the source's row and byte caps. The
 * byte cap counts each row as the JSON it will be sent as.
 * @param rows - The rows read so far.
 * @param limits - The caps.
 * @param limits.maxRows - Row cap.
 * @param limits.maxResultBytes - Byte cap.
 */
export function capRows(rows: readonly unknown[][], limits: { maxRows: number; maxResultBytes: number }): { rows: unknown[][]; truncated: 'rows' | 'bytes' | null } {
  const kept: unknown[][] = [];
  let bytes = 0;
  for (const row of rows) {
    if (kept.length >= limits.maxRows) {
      return { rows: kept, truncated: 'rows' };
    }
    bytes += JSON.stringify(row).length + 1;
    if (bytes > limits.maxResultBytes) {
      return { rows: kept, truncated: 'bytes' };
    }
    kept.push(row);
  }
  return { rows: kept, truncated: null };
}
