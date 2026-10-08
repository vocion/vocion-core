/**
 * AMAZON REDSHIFT — a provider of the warehouse family (`../provider.ts`),
 * through the Redshift Data API.
 *
 * Every query runs on ONE Data API session — a database connection kept open
 * between calls (`SessionKeepAliveSeconds`, then `SessionId`), so each call
 * below lands on the same connection, in order:
 *
 *   1. `SET statement_timeout` to the source's limit, and `SET search_path`
 *      to the allowlist, so an unqualified name resolves only there.
 *   2. `EXPLAIN` the statement. Redshift plans only SELECT, SELECT INTO,
 *      CREATE TABLE AS, INSERT, UPDATE and DELETE, so anything else (DDL,
 *      GRANT, CALL, a second statement) fails here and is refused; a plan
 *      with a write operator is refused too.
 *   3. Resolve every relation the plan scans against
 *      `information_schema.tables`, which lists only what this database user
 *      can read: a relation in no allowed schema is refused, and a name that
 *      is in an allowed schema AND in another schema the user can read is
 *      refused as ambiguous — Redshift's plan prints a local table without
 *      its schema, so the two cannot be told apart. Narrow the user's grants
 *      and the ambiguity goes away.
 *   4. `BEGIN READ ONLY`, then the statement, then `ROLLBACK`. A sequence of
 *      ExecuteStatement calls on the session was chosen over one
 *      BatchExecuteStatement because a batch in its default TRANSACTION mode
 *      wraps its own transaction around the list (a `BEGIN` inside it would
 *      not open the read-only block the statement must run in), and
 *      AUTO_COMMIT mode is documented only as committing each statement
 *      separately. The session gives the documented guarantee: same
 *      connection, one statement at a time, in order. If anything is left
 *      open the session idles out and the transaction is rolled back.
 *
 * ExecuteStatement takes exactly one SQL statement ("This statement must be a
 * single SQL statement", API reference), so a `; COMMIT; …` tail cannot step out
 * of the read-only transaction: the driver refuses the text whole.
 *
 * The statement itself is never rewritten; ordering and LIMIT stay the
 * agent's. Rows past the caps are not read.
 */

import type { WarehouseProvider, WarehouseQueryResult } from '../provider';
import type { FamilySource } from '@/libs/connectors/families';
import type { PlannedScan, RedshiftDataFactory, RedshiftTarget, Sleep, StsFactory } from '@/libs/redshift/client';
import { DescribeTableCommand, ListTablesCommand } from '@aws-sdk/client-redshift-data';
import {
  awsCredentialsFor,
  connectionParams,
  defaultRedshiftData,
  quoteIdent,
  readPlan,
  redshiftCredentialsFrom,
  RedshiftSession,
  RedshiftStatementError,
  redshiftTargetFrom,
  RedshiftTimeoutError,
} from '@/libs/redshift/client';
import { redshiftConfigSchema } from '@/libs/sources/redshift';
import { capRows, limitsFrom, qualifySchemas, runnableSql, schemaAllowed, WarehouseRefusal } from '@/libs/warehouse/guard';
import { familySourceCredentials, noCredentialMessage } from '@/services/connectors/familyCredentials';

const VENDOR = 'Redshift';

/** Seams for tests: the AWS clients and the clock. */
export type RedshiftProviderDeps = { data?: RedshiftDataFactory; sts?: StsFactory; sleep?: Sleep; now?: () => number };

/**
 * The catalog's verdict on the relations a plan scans, thrown as a
 * `WarehouseRefusal` when the statement may not run.
 * @param input - The scans, where each name was found, and the allowlist.
 * @param input.scans - The relations the plan scans.
 * @param input.readable - Each readable relation's schema, keyed by lower-cased name.
 * @param input.allowed - The allowlist.
 */
export function judgeScans(input: { scans: readonly PlannedScan[]; readable: ReadonlyMap<string, readonly string[]>; allowed: readonly string[] }): void {
  const outside: string[] = [];
  const ambiguous: string[] = [];
  for (const scan of input.scans) {
    if (scan.schema) {
      if (!schemaAllowed(scan.schema, input.allowed)) {
        outside.push(`${scan.schema}.${scan.name}`);
      }
      continue;
    }
    const schemas = input.readable.get(scan.name.toLowerCase()) ?? [];
    const inside = schemas.filter(s => schemaAllowed(s, input.allowed));
    const other = schemas.filter(s => !schemaAllowed(s, input.allowed));
    if (inside.length === 0) {
      outside.push(other.length > 0 ? `${other[0]}.${scan.name}` : scan.name);
    } else if (other.length > 0) {
      ambiguous.push(`${scan.name} (in ${[...inside, ...other].join(' and ')})`);
    }
  }
  if (outside.length > 0) {
    throw new WarehouseRefusal(`This query reads ${[...new Set(outside)].join(', ')}, which is in none of the schemas this ${VENDOR} source allows (${input.allowed.join(', ')}). It was not run. Query only those schemas; a schema is added on the source, not here.`);
  }
  if (ambiguous.length > 0) {
    throw new WarehouseRefusal(`This query reads ${[...new Set(ambiguous)].join(', ')}: a table with that name is in an allowed schema and in another this database user can read, and Redshift's plan does not say which one the query reads. It was not run. An admin can narrow the database user's grants to the allowed schemas, which ends the ambiguity.`);
  }
}

/**
 * The Redshift provider for one source.
 * @param orgId - The workspace.
 * @param source - The `redshift` source.
 * @param deps - Test seams.
 */
export async function redshiftWarehouseProvider(orgId: string, source: FamilySource, deps: RedshiftProviderDeps = {}): Promise<WarehouseProvider> {
  const config = redshiftConfigSchema.parse(source.config);
  const targetResult = redshiftTargetFrom(config);
  if (!targetResult.ok) {
    throw new Error(targetResult.message);
  }
  const target: RedshiftTarget = targetResult.target;
  const bag = await familySourceCredentials(orgId, source);
  if (!bag) {
    throw new Error(noCredentialMessage(source, VENDOR));
  }
  const parsed = redshiftCredentialsFrom(bag);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  const credentials = await awsCredentialsFor(parsed.credentials, { orgId, region: target.region }, deps.sts);
  const client = (deps.data ?? defaultRedshiftData)({ region: target.region, credentials });
  const now = deps.now ?? Date.now;
  const limits = limitsFrom(config);
  const schemas = qualifySchemas(config.schemas, null);

  async function query(sql: string, opts: { maxRows: number }): Promise<WarehouseQueryResult> {
    const statement = runnableSql(sql);
    const deadline = now() + limits.timeoutSeconds * 1000;
    const session = new RedshiftSession(client, target, limits.timeoutSeconds + 60, deps.sleep, now);
    let inTransaction = false;
    try {
      await session.run(`SET statement_timeout TO ${limits.timeoutSeconds * 1000}`, { deadline });
      await session.run(`SET search_path TO ${schemas.map(quoteIdent).join(', ')}`, { deadline });

      let planLines: string[];
      try {
        const explained = await session.run(`EXPLAIN ${statement}`, { deadline });
        planLines = (await session.rows(explained.id, 10_000, 5_000_000)).rows.map(r => String(r[0] ?? ''));
      } catch (err) {
        if (err instanceof RedshiftStatementError) {
          throw new WarehouseRefusal(`Redshift would not plan this as one query (${err.message}). Only a single SELECT runs here; it was not run.`);
        }
        throw err;
      }
      const plan = readPlan(planLines);
      if (plan.writes) {
        throw new WarehouseRefusal('Redshift plans this statement as a write (an Insert, Update or Delete step). Only a SELECT runs here; it was not run.');
      }
      const unqualified = [...new Set(plan.scans.filter(s => !s.schema).map(s => s.name))];
      const readable = new Map<string, string[]>();
      if (unqualified.length > 0) {
        const params = unqualified.map((name, i) => ({ name: `t${i}`, value: name }));
        // information_schema.tables lists only the relations this user can read.
        const looked = await session.run(
          `SELECT table_schema, table_name FROM information_schema.tables WHERE table_name IN (${params.map(p => `:${p.name}`).join(', ')})`,
          { parameters: params, deadline },
        );
        for (const [schema, name] of (await session.rows(looked.id, 10_000, 5_000_000)).rows) {
          const key = String(name).toLowerCase();
          readable.set(key, [...(readable.get(key) ?? []), String(schema)]);
        }
      }
      judgeScans({ scans: plan.scans, readable, allowed: schemas });

      await session.run('BEGIN READ ONLY', { deadline });
      inTransaction = true;
      let ran: { id: string; hasResultSet: boolean };
      try {
        ran = await session.run(statement, { deadline });
      } catch (err) {
        if (err instanceof RedshiftTimeoutError) {
          throw new Error(`The query ran past this source's ${limits.timeoutSeconds}-second limit and was cancelled. Narrow it (a date filter, fewer columns) or aggregate.`);
        }
        if (err instanceof RedshiftStatementError) {
          throw new Error(`Redshift: ${err.message}`);
        }
        throw err;
      }
      const result = ran.hasResultSet ? await session.rows(ran.id, opts.maxRows + 1, limits.maxResultBytes) : { columns: [], rows: [], totalRows: 0 };
      const capped = capRows(result.rows, { maxRows: opts.maxRows, maxResultBytes: limits.maxResultBytes });
      return { columns: result.columns, rows: capped.rows, totalRows: result.totalRows, truncated: capped.truncated, bytesScanned: null, queryId: ran.id };
    } catch (err) {
      if (err instanceof RedshiftTimeoutError) {
        throw new Error(`Redshift did not finish preparing the query within this source's ${limits.timeoutSeconds}-second limit.`);
      }
      throw err;
    } finally {
      if (inTransaction) {
        await session.run('ROLLBACK').catch(() => undefined);
      }
    }
  }

  return {
    kind: source.kind,
    sourceSlug: source.slug,
    vendor: VENDOR,
    dialect: 'Amazon Redshift SQL (PostgreSQL 8 based): tables as schema.table',
    schemas,
    limits,
    async listTables(schema) {
      const out: Array<{ schema: string; name: string; kind: string; comment: string | null; rowCount: number | null }> = [];
      let token: string | undefined;
      do {
        const page = await client.send(new ListTablesCommand({ ...connectionParams(target), SchemaPattern: schema, MaxResults: 1000, ...(token ? { NextToken: token } : {}) }));
        for (const t of page.Tables ?? []) {
          if (t.name && (!t.schema || t.schema === schema)) {
            out.push({ schema, name: t.name, kind: (t.type ?? 'TABLE').toLowerCase(), comment: null, rowCount: null });
          }
        }
        token = page.NextToken;
      } while (token && out.length < 1000);
      return out;
    },
    async describeTable(schema, table) {
      const columns: Array<{ name: string; type: string; nullable: boolean | null; comment: string | null }> = [];
      let token: string | undefined;
      let name = table;
      do {
        const page = await client.send(new DescribeTableCommand({ ...connectionParams(target), Schema: schema, Table: table, ...(token ? { NextToken: token } : {}) }));
        name = page.TableName ?? name;
        for (const c of page.ColumnList ?? []) {
          columns.push({ name: c.name ?? '', type: c.typeName ?? 'unknown', nullable: c.nullable === undefined ? null : c.nullable !== 0, comment: null });
        }
        token = page.NextToken;
      } while (token);
      if (columns.length === 0) {
        throw new Error(`No table ${schema}.${table} this database user can read.`);
      }
      return { table: { schema, name, kind: 'table', comment: null, rowCount: null }, columns };
    },
    query,
  };
}
