/**
 * BIGQUERY — a provider of the warehouse family (`../provider.ts`).
 *
 * Read-only as BigQuery itself judges it: every statement is first planned
 * with a dry run (`jobs.insert`, `dryRun: true`), and only one BigQuery
 * reports as `statementType: SELECT` runs — a script, DML, DDL or DCL is
 * refused naming its type. The same dry run reports the tables the statement
 * reads (`referencedTables`), which are held to the source's allowlist
 * before anything runs, and the bytes it would process, held to the source's
 * `maxGbBilled`. The run itself is `jobs.query` on a token minted with the
 * `bigquery.readonly` scope, with `maximumBytesBilled` set, so even a
 * statement the dry run misjudged could neither write nor overspend.
 *
 * Fail closed: a dry run that lists 50 or more tables may be incomplete
 * (BigQuery stops listing), and one that reads bytes while naming no table
 * read something it did not report — both are refused.
 */

import type { WarehouseColumn, WarehouseProvider, WarehouseQueryResult, WarehouseTableInfo } from '../provider';
import type { BigqueryCredentials, BigqueryFetch, BigqueryField, BigqueryJobRef, BigqueryQueryPage } from '@/libs/bigquery/client';
import type { FamilySource } from '@/libs/connectors/families';
import {
  bigqueryCredentialsFrom,
  cancelJob,
  convertRows,
  dryRunQuery,
  getTable,
  listTables,
  queryResults,
  startQuery,
} from '@/libs/bigquery/client';
import { bigqueryConfigSchema } from '@/libs/sources/bigquery';
import { capRows, limitsFrom, qualifySchemas, refuseOutsideAllowlist, runnableSql, WarehouseRefusal } from '@/libs/warehouse/guard';
import { familySourceCredentials, noCredentialMessage } from '@/services/connectors/familyCredentials';

const VENDOR = 'BigQuery';
const GB = 1_000_000_000;
/** BigQuery stops listing referenced tables somewhere past this; a list this long may be incomplete. */
const REFERENCED_TABLES_CAP = 50;
/** One wait inside a jobs.query / getQueryResults call; the source's timeout bounds the total. */
const POLL_MS = 10_000;

/** Seams for tests: the network and the clock. */
export type BigqueryProviderDeps = { fetch?: BigqueryFetch; now?: () => number };

/**
 * A dataset allowlist entry split into project and dataset.
 * @param qualified - `project.dataset`.
 */
function splitDataset(qualified: string): { project: string; dataset: string } {
  const at = qualified.lastIndexOf('.');
  return { project: qualified.slice(0, at), dataset: qualified.slice(at + 1) };
}

/**
 * The guard's dry-run verdict, thrown as a `WarehouseRefusal` when the
 * statement may not run. Exported for Test connection's sake and for tests.
 * @param input - What the dry run said and what the source allows.
 * @param input.statementType - The dry run's statement type.
 * @param input.referencedTables - The tables it reads.
 * @param input.totalBytesProcessed - The bytes it would process.
 * @param input.allowed - The qualified allowlist.
 * @param input.maxBytes - The source's billing cap, in bytes.
 */
export function judgeDryRun(input: { statementType: string | null; referencedTables: Array<{ projectId: string; datasetId: string; tableId: string }> | null; totalBytesProcessed: number; allowed: readonly string[]; maxBytes: number }): void {
  if (input.statementType !== 'SELECT') {
    throw new WarehouseRefusal(`BigQuery reads this as ${input.statementType ? `a ${input.statementType} statement` : 'something other than one query'}; only a SELECT runs here. It was not run.`);
  }
  const tables = input.referencedTables ?? [];
  if (tables.length >= REFERENCED_TABLES_CAP) {
    throw new WarehouseRefusal(`This query reads ${tables.length} or more tables, more than BigQuery reports in full, so the allowed datasets cannot be checked. It was not run. Read fewer tables per query.`);
  }
  if (tables.length === 0 && input.totalBytesProcessed > 0) {
    throw new WarehouseRefusal('BigQuery says this query reads data but names no table it reads, so the allowed datasets cannot be checked. It was not run. Query tables in the allowed datasets by name.');
  }
  refuseOutsideAllowlist({
    vendor: VENDOR,
    referenced: tables.map(t => ({ schema: `${t.projectId}.${t.datasetId}`, name: t.tableId })),
    allowed: input.allowed,
  });
  if (input.totalBytesProcessed > input.maxBytes) {
    throw new WarehouseRefusal(`This query would process ${(input.totalBytesProcessed / GB).toFixed(2)} GB, over this source's cap of ${(input.maxBytes / GB).toFixed(0)} GB. It was not run. Filter on a partition column or select fewer columns.`);
  }
}

function flattenColumns(fields: readonly BigqueryField[], prefix = ''): WarehouseColumn[] {
  return fields.flatMap((f) => {
    const name = `${prefix}${f.name}`;
    const type = f.mode === 'REPEATED' ? `ARRAY<${f.type}>` : f.type;
    const column: WarehouseColumn = { name, type, nullable: f.mode !== 'REQUIRED', comment: f.description ?? null };
    return [column, ...(f.fields ? flattenColumns(f.fields, `${name}.`) : [])];
  });
}

/**
 * The BigQuery provider for one source.
 * @param orgId - The workspace.
 * @param source - The `bigquery` source.
 * @param deps - Test seams.
 */
export async function bigqueryWarehouseProvider(orgId: string, source: FamilySource, deps: BigqueryProviderDeps = {}): Promise<WarehouseProvider> {
  const config = bigqueryConfigSchema.parse(source.config);
  const bag = await familySourceCredentials(orgId, source);
  if (!bag) {
    throw new Error(noCredentialMessage(source, VENDOR));
  }
  const parsed = bigqueryCredentialsFrom(bag);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  const creds: BigqueryCredentials = parsed.credentials;
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const limits = limitsFrom(config);
  const schemas = qualifySchemas(config.schemas, creds.projectId);
  const maxBytes = config.maxGbBilled * GB;

  async function query(sql: string, opts: { maxRows: number }): Promise<WarehouseQueryResult> {
    const statement = runnableSql(sql);
    const plan = await dryRunQuery(creds, { query: statement, location: config.location }, doFetch);
    judgeDryRun({ ...plan, allowed: schemas, maxBytes });

    const deadline = now() + limits.timeoutSeconds * 1000;
    const wantRows = opts.maxRows + 1;
    let page: BigqueryQueryPage = await startQuery(creds, {
      query: statement,
      location: config.location,
      maxResults: wantRows,
      timeoutMs: Math.min(POLL_MS, limits.timeoutSeconds * 1000),
      maximumBytesBilled: maxBytes,
    }, doFetch);
    const job: BigqueryJobRef | undefined = page.jobReference;
    while (!page.jobComplete) {
      if (!job) {
        throw new Error('BigQuery started the query but returned no job to wait on.');
      }
      const left = deadline - now();
      if (left <= 0) {
        await cancelJob(creds, job, doFetch);
        throw new Error(`The query ran past this source's ${limits.timeoutSeconds}-second limit and was cancelled. Narrow it (a date filter, fewer columns) or aggregate.`);
      }
      page = await queryResults(creds, job, { maxResults: wantRows, timeoutMs: Math.min(POLL_MS, left) }, doFetch);
    }

    const fields = page.schema?.fields ?? [];
    const rows = convertRows(fields, page.rows ?? []);
    // Read further pages only while under both caps.
    let token = page.pageToken;
    let bytes = JSON.stringify(rows).length;
    while (token && rows.length < wantRows && bytes <= limits.maxResultBytes) {
      if (!job) {
        break;
      }
      const next = await queryResults(creds, job, { pageToken: token, maxResults: wantRows - rows.length, timeoutMs: POLL_MS }, doFetch);
      const more = convertRows(fields, next.rows ?? []);
      rows.push(...more);
      bytes += JSON.stringify(more).length;
      token = next.pageToken;
    }
    const capped = capRows(rows, { maxRows: opts.maxRows, maxResultBytes: limits.maxResultBytes });
    const totalRows = page.totalRows !== undefined ? Number(page.totalRows) : null;
    return {
      columns: fields.map(f => ({ name: f.name, type: f.mode === 'REPEATED' ? `ARRAY<${f.type}>` : f.type })),
      rows: capped.rows,
      totalRows,
      truncated: capped.truncated,
      bytesScanned: Number(page.totalBytesBilled ?? page.totalBytesProcessed ?? plan.totalBytesProcessed) || null,
      queryId: job?.jobId ?? null,
    };
  }

  async function tableInfo(schema: string, tableId: string): Promise<{ info: WarehouseTableInfo; fields: BigqueryField[] }> {
    const { project, dataset } = splitDataset(schema);
    const table = await getTable(creds, { projectId: project, datasetId: dataset, tableId }, doFetch);
    return {
      info: { schema, name: tableId, kind: (table.type ?? 'TABLE').toLowerCase(), comment: table.description ?? null, rowCount: table.numRows !== undefined ? Number(table.numRows) : null },
      fields: table.schema?.fields ?? [],
    };
  }

  return {
    kind: source.kind,
    sourceSlug: source.slug,
    vendor: VENDOR,
    dialect: 'GoogleSQL (BigQuery standard SQL): tables as `project.dataset.table` in backticks',
    schemas,
    limits,
    async listTables(schema) {
      const { project, dataset } = splitDataset(schema);
      const tables = await listTables(creds, project, dataset, 1000, doFetch);
      return tables.map(t => ({ schema, name: t.tableId, kind: t.type.toLowerCase(), comment: null, rowCount: null }));
    },
    async describeTable(schema, table) {
      const { info, fields } = await tableInfo(schema, table);
      return { table: info, columns: flattenColumns(fields) };
    },
    query,
  };
}
