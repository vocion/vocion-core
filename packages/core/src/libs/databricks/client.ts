/**
 * Databricks SQL Statement Execution API 2.0 client — the one place that
 * knows how to run a statement on a Databricks SQL warehouse.
 *
 * Facts this file depends on (docs.databricks.com/api/workspace/statementexecution):
 *   - `POST /api/2.0/sql/statements` takes ONE statement (the API refuses a
 *     second), `warehouse_id`, `catalog`, named `parameters`
 *     (`[{ name, value, type }]`, `:name` in the SQL), `row_limit`,
 *     `byte_limit`, `wait_timeout` ("0s" or 5–50s), `on_wait_timeout`
 *     (CONTINUE | CANCEL), `disposition` INLINE and `format` JSON_ARRAY.
 *   - The answer carries `statement_id`, `status.state` (PENDING, RUNNING,
 *     SUCCEEDED, FAILED, CANCELED, CLOSED) with `status.error.message`,
 *     `manifest.schema.columns` (name, type_name), `manifest.total_row_count`,
 *     `manifest.truncated`, and `result.data_array` (values as strings).
 *   - `GET /api/2.0/sql/statements/{id}` polls; `POST …/{id}/cancel` cancels;
 *     `GET …/{id}/result/chunks/{n}` reads a later chunk.
 *   - `GET /api/2.0/sql/warehouses/{id}` reads a warehouse (Test connection).
 *
 * Errors are thrown as `DatabricksError`, written for a person, never
 * carrying the token. Nothing is cached.
 */

export type DatabricksCredentials = {
  /** `https://dbc-….cloud.databricks.com`, no trailing slash. */
  host: string;
  token: string;
};

export type DatabricksColumn = { name: string; type: string };

export type DatabricksResult = {
  statementId: string | null;
  columns: DatabricksColumn[];
  rows: Array<Array<string | null>>;
  totalRows: number | null;
  /** Whether Databricks itself cut the result at `row_limit` or `byte_limit`. */
  truncated: boolean;
};

export class DatabricksError extends Error {
  readonly status: number | null;
  /** Databricks's own error code, when it sent one (PARSE_SYNTAX_ERROR, TABLE_OR_VIEW_NOT_FOUND…). */
  readonly code: string | null;
  constructor(message: string, status: number | null, code: string | null = null) {
    super(message);
    this.name = 'DatabricksError';
    this.status = status;
    this.code = code;
  }
}

type Fetch = typeof fetch;

/**
 * The credential bag as a typed credential, or why it cannot be used.
 * @param bag - The decrypted credential values.
 */
export function databricksCredentialsFrom(bag: Record<string, unknown> | null | undefined): { ok: true; credentials: DatabricksCredentials } | { ok: false; message: string } {
  const host = typeof bag?.host === 'string' ? bag.host.trim().replace(/\/+$/, '') : '';
  const token = typeof bag?.token === 'string' ? bag.token.trim() : '';
  if (!host || !token) {
    return { ok: false, message: 'The Databricks credential needs the workspace URL and a personal access token. Paste both on the Connections page.' };
  }
  if (!/^https:\/\/[^\s/]+$/i.test(host)) {
    return { ok: false, message: 'The Databricks workspace URL must be an https:// address such as https://dbc-1a2b3c4d-5e6f.cloud.databricks.com.' };
  }
  return { ok: true, credentials: { host, token } };
}

type StatementBody = {
  statement_id?: string;
  status?: { state?: string; error?: { message?: string; error_code?: string } };
  manifest?: { schema?: { columns?: Array<{ name?: string; type_name?: string; type_text?: string }> }; total_row_count?: number; truncated?: boolean; total_chunk_count?: number };
  result?: { data_array?: Array<Array<string | null>>; next_chunk_index?: number };
  message?: string;
  error_code?: string;
};

function headers(c: DatabricksCredentials): Record<string, string> {
  return { 'authorization': `Bearer ${c.token}`, 'content-type': 'application/json', 'accept': 'application/json', 'user-agent': 'Vocion/1.0' };
}

async function readBody(res: Response): Promise<StatementBody> {
  try {
    return await res.json() as StatementBody;
  } catch {
    return {};
  }
}

function httpFailure(status: number, body: StatementBody): DatabricksError {
  if (status === 401 || status === 403) {
    return new DatabricksError(`Databricks refused the token (HTTP ${status}). Check the token is live, was made in this workspace, and its owner can use the SQL warehouse.`, status, body.error_code ?? null);
  }
  if (status === 404) {
    return new DatabricksError(`Databricks found nothing there (HTTP 404)${body.message ? `: ${body.message}` : ''}. Check the workspace URL and the SQL warehouse ID.`, status, body.error_code ?? null);
  }
  if (status === 429) {
    return new DatabricksError('Databricks is rate-limiting this workspace; try again in a minute.', status, body.error_code ?? null);
  }
  return new DatabricksError(body.message ? `Databricks: ${body.message}` : `Databricks answered HTTP ${status}.`, status, body.error_code ?? null);
}

/**
 * Read one SQL warehouse: whether the token reaches it, and its name and state.
 * @param c - The credential.
 * @param warehouseId - The warehouse.
 * @param doFetch - The network, injected in tests.
 */
export async function readDatabricksWarehouse(c: DatabricksCredentials, warehouseId: string, doFetch: Fetch = fetch): Promise<{ name: string | null; state: string | null }> {
  let res: Response;
  try {
    res = await doFetch(`${c.host}/api/2.0/sql/warehouses/${encodeURIComponent(warehouseId)}`, { method: 'GET', headers: headers(c) });
  } catch {
    throw new DatabricksError(`Databricks could not be reached at ${c.host}. Check the workspace URL.`, null);
  }
  const body = await res.json().catch(() => ({})) as { name?: string; state?: string; message?: string; error_code?: string };
  if (!res.ok) {
    throw httpFailure(res.status, body);
  }
  return { name: body.name ?? null, state: body.state ?? null };
}

export type DatabricksRunOptions = {
  warehouseId: string;
  catalog?: string;
  timeoutSeconds: number;
  /** Databricks stops the result at this many rows (it is sent one past the cap, so a cut shows). */
  rowLimit?: number;
  /** Databricks stops the result at this many bytes. */
  byteLimit?: number;
  parameters?: Array<{ name: string; value: string }>;
  doFetch?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/**
 * Run one statement and read back its rows: submit, poll while it runs,
 * cancel at the deadline, read later chunks up to the row limit.
 * @param c - The credential.
 * @param statement - The SQL.
 * @param opts - Where it runs, its limits, and test seams.
 */
export async function runDatabricksStatement(c: DatabricksCredentials, statement: string, opts: DatabricksRunOptions): Promise<DatabricksResult> {
  const doFetch = opts.doFetch ?? fetch;
  const sleep = opts.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const now = opts.now ?? Date.now;
  const deadline = now() + opts.timeoutSeconds * 1000;
  const body = {
    statement,
    warehouse_id: opts.warehouseId,
    ...(opts.catalog ? { catalog: opts.catalog } : {}),
    ...(opts.parameters?.length ? { parameters: opts.parameters.map(p => ({ name: p.name, value: p.value, type: 'STRING' })) } : {}),
    ...(opts.rowLimit ? { row_limit: opts.rowLimit } : {}),
    ...(opts.byteLimit ? { byte_limit: opts.byteLimit } : {}),
    wait_timeout: `${Math.max(5, Math.min(50, opts.timeoutSeconds))}s`,
    on_wait_timeout: 'CONTINUE',
    disposition: 'INLINE',
    format: 'JSON_ARRAY',
  };
  let res: Response;
  try {
    res = await doFetch(`${c.host}/api/2.0/sql/statements`, { method: 'POST', headers: headers(c), body: JSON.stringify(body) });
  } catch {
    throw new DatabricksError(`Databricks could not be reached at ${c.host}. Check the workspace URL.`, null);
  }
  let payload = await readBody(res);
  if (!res.ok) {
    throw httpFailure(res.status, payload);
  }
  const id = payload.statement_id ?? null;
  while (payload.status?.state === 'PENDING' || payload.status?.state === 'RUNNING') {
    if (now() >= deadline) {
      if (id) {
        await doFetch(`${c.host}/api/2.0/sql/statements/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers: headers(c) }).catch(() => undefined);
      }
      throw new DatabricksError(`The statement ran past the ${opts.timeoutSeconds}-second limit and was cancelled. Narrow it (a WHERE on a date, fewer columns) or aggregate.`, null);
    }
    await sleep(1000);
    const poll = await doFetch(`${c.host}/api/2.0/sql/statements/${encodeURIComponent(id ?? '')}`, { method: 'GET', headers: headers(c) });
    payload = await readBody(poll);
    if (!poll.ok) {
      throw httpFailure(poll.status, payload);
    }
  }
  const state = payload.status?.state;
  if (state !== 'SUCCEEDED') {
    const err = payload.status?.error;
    throw new DatabricksError(err?.message ? `Databricks: ${err.message}` : `The statement ended ${state ?? 'without a state'}.`, null, err?.error_code ?? null);
  }
  const columns = (payload.manifest?.schema?.columns ?? []).map(col => ({ name: col.name ?? '', type: (col.type_name ?? col.type_text ?? 'STRING').toUpperCase() }));
  const rows = [...(payload.result?.data_array ?? [])];
  let next = id === null ? undefined : payload.result?.next_chunk_index;
  const cap = opts.rowLimit ?? Number.POSITIVE_INFINITY;
  while (typeof next === 'number' && rows.length < cap) {
    const chunk = await doFetch(`${c.host}/api/2.0/sql/statements/${encodeURIComponent(id ?? '')}/result/chunks/${next}`, { method: 'GET', headers: headers(c) });
    const chunkBody = await chunk.json().catch(() => ({})) as { data_array?: Array<Array<string | null>>; next_chunk_index?: number; message?: string };
    if (!chunk.ok) {
      throw httpFailure(chunk.status, chunkBody);
    }
    rows.push(...(chunkBody.data_array ?? []));
    next = chunkBody.next_chunk_index;
  }
  return { statementId: id, columns, rows, totalRows: payload.manifest?.total_row_count ?? null, truncated: payload.manifest?.truncated === true };
}

const INTEGER_TYPES = new Set(['BYTE', 'TINYINT', 'SHORT', 'SMALLINT', 'INT', 'INTEGER', 'LONG', 'BIGINT']);
const FLOAT_TYPES = new Set(['FLOAT', 'DOUBLE', 'REAL']);

/**
 * A Databricks value as a JSON-safe scalar: integers that fit and floats as
 * numbers, booleans, everything else (DECIMAL, big integers, dates) as text.
 * @param value - The cell as Databricks sent it.
 * @param column - Its column.
 */
export function databricksValue(value: string | null, column: DatabricksColumn | undefined): unknown {
  if (value === null || !column) {
    return value;
  }
  if (column.type === 'BOOLEAN') {
    return value === 'true' ? true : value === 'false' ? false : value;
  }
  if (INTEGER_TYPES.has(column.type)) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : value;
  }
  if (FLOAT_TYPES.has(column.type)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  return value;
}
