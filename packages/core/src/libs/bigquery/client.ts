/**
 * BigQuery over REST — the calls the warehouse provider and Test connection
 * make, all on an injectable `fetch` so a test stands in front of them with
 * no network and no credential.
 *
 * Auth is a service account's signed JWT-bearer assertion exchanged for an
 * access token (Google's server-to-server flow, the one `libs/analytics/ga4.ts`
 * runs). Two scopes, on purpose:
 *
 *   - `bigquery.readonly` for everything that reads — `jobs.query`,
 *     `jobs.getQueryResults`, the table browse. A token with this scope cannot
 *     be spent on a write, whatever the service account's roles.
 *   - `bigquery` only for the dry run (`jobs.insert` with `dryRun: true`),
 *     because `jobs.insert` accepts no read-only scope and the dry run is the
 *     one call that reports a statement's type and the tables it reads. A dry
 *     run executes nothing.
 *
 * Tokens are cached by a digest of the exact key and scope that minted them,
 * never by org: a rotated key takes effect on the next call.
 */

import { Buffer } from 'node:buffer';
import { createHash, createSign } from 'node:crypto';

export const BIGQUERY_API = 'https://bigquery.googleapis.com/bigquery/v2';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const READONLY_SCOPE = 'https://www.googleapis.com/auth/bigquery.readonly';
export const DRY_RUN_SCOPE = 'https://www.googleapis.com/auth/bigquery';

export type BigqueryCredentials = { projectId: string; clientEmail: string; privateKey: string };
export type BigqueryFetch = typeof fetch;

/**
 * The credential bag as a BigQuery service account, or what is missing, in
 * words a person acts on. A private key pasted straight out of the JSON file
 * carries literal `\n` sequences; they are turned back into newlines.
 * @param bag - The decrypted credential values.
 */
export function bigqueryCredentialsFrom(bag: Record<string, unknown> | null | undefined): { ok: true; credentials: BigqueryCredentials } | { ok: false; message: string } {
  const read = (key: string) => (typeof bag?.[key] === 'string' ? (bag[key] as string).trim() : '');
  const projectId = read('projectId');
  const clientEmail = read('clientEmail');
  const raw = read('privateKey');
  const missing = [!projectId && 'project ID', !clientEmail && 'service account email', !raw && 'private key'].filter(Boolean);
  if (missing.length > 0) {
    return { ok: false, message: `The BigQuery credential is missing its ${missing.join(', ')}. Paste the project_id, client_email and private_key values from the service account's JSON key.` };
  }
  const privateKey = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
  if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
    return { ok: false, message: 'The BigQuery private key is not a PEM key. Paste the private_key value from the service account JSON, beginning -----BEGIN PRIVATE KEY-----.' };
  }
  return { ok: true, credentials: { projectId, clientEmail, privateKey } };
}

/** A BigQuery or Google token refusal, with the message to show for it. */
export class BigqueryError extends Error {
  readonly status: number;
  readonly reason: string | null;

  constructor(message: string, status: number, reason: string | null) {
    super(message);
    this.name = 'BigqueryError';
    this.status = status;
    this.reason = reason;
  }
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function digest(creds: BigqueryCredentials, scope: string): string {
  return createHash('sha256').update(creds.clientEmail).update('\0').update(creds.privateKey).update('\0').update(scope).digest('hex');
}

/** Drop every cached token. Test seam. */
export function resetBigqueryTokenCache(): void {
  tokenCache.clear();
}

function signAssertion(creds: BigqueryCredentials, scope: string, now: number): string {
  const issuedAt = Math.floor(now / 1000);
  const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url');
  const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64(JSON.stringify({ iss: creds.clientEmail, scope, aud: TOKEN_ENDPOINT, iat: issuedAt, exp: issuedAt + 3600 }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  let signature: Buffer;
  try {
    signature = signer.sign(creds.privateKey);
  } catch (cause) {
    // The crypto error can quote key material, so it is logged and replaced.
    console.error('[bigquery] the stored service-account private key could not sign', cause);
    throw new BigqueryError('The stored BigQuery private key could not sign a request. Re-paste the private_key value from the service account JSON.', 0, 'bad_key');
  }
  return `${header}.${claims}.${b64(signature)}`;
}

/**
 * An access token for the service account at one scope, minted or reused.
 * @param creds - The service account.
 * @param scope - The OAuth scope.
 * @param doFetch - The network.
 * @param now - The clock, in ms.
 */
export async function bigqueryAccessToken(creds: BigqueryCredentials, scope: string, doFetch: BigqueryFetch = fetch, now: number = Date.now()): Promise<string> {
  const key = digest(creds, scope);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > now + 5 * 60_000) {
    return cached.token;
  }
  let res: Response;
  try {
    res = await doFetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signAssertion(creds, scope, now) }).toString(),
    });
  } catch (err) {
    if (err instanceof BigqueryError) {
      throw err;
    }
    throw new BigqueryError(`Google could not be reached for a BigQuery token (${(err as Error).message}).`, 0, 'unreachable');
  }
  if (!res.ok) {
    console.error('[bigquery] Google refused a service-account token', { status: res.status });
    throw new BigqueryError(res.status === 400 || res.status === 401
      ? 'Google rejected the stored BigQuery service account. Check the email and private key come from the same, still-active key.'
      : `Google would not issue a BigQuery token (HTTP ${res.status}).`, res.status, 'token_refused');
  }
  const data = await res.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new BigqueryError('Google returned no access token for the stored BigQuery service account.', res.status, 'token_refused');
  }
  tokenCache.set(key, { token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
}

type ApiCall = { method?: 'GET' | 'POST'; path: string; query?: Record<string, string | undefined>; body?: unknown; scope?: string };

/**
 * One authorised call to the BigQuery API. A refusal throws `BigqueryError`
 * carrying Google's own message, which names the problem (a syntax error, a
 * missing permission) and never the credential.
 * @param creds - The service account.
 * @param call - What to call.
 * @param doFetch - The network.
 */
export async function bigqueryCall<T>(creds: BigqueryCredentials, call: ApiCall, doFetch: BigqueryFetch = fetch): Promise<T> {
  const token = await bigqueryAccessToken(creds, call.scope ?? READONLY_SCOPE, doFetch);
  const url = new URL(`${BIGQUERY_API}${call.path}`);
  for (const [k, v] of Object.entries(call.query ?? {})) {
    if (v !== undefined) {
      url.searchParams.set(k, v);
    }
  }
  let res: Response;
  try {
    res = await doFetch(url.toString(), {
      method: call.method ?? 'GET',
      headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
      ...(call.body !== undefined ? { body: JSON.stringify(call.body) } : {}),
    });
  } catch (err) {
    throw new BigqueryError(`BigQuery could not be reached (${(err as Error).message}).`, 0, 'unreachable');
  }
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const error = (parsed as { error?: { message?: string; errors?: Array<{ reason?: string }> } } | null)?.error;
    const reason = error?.errors?.[0]?.reason ?? null;
    throw new BigqueryError(error?.message ? `BigQuery: ${error.message}` : `BigQuery answered HTTP ${res.status}.`, res.status, reason);
  }
  return (parsed ?? {}) as T;
}

/** A table reference as BigQuery names one. */
export type BigqueryTableRef = { projectId: string; datasetId: string; tableId: string };

export type BigqueryField = { name: string; type: string; mode?: string; description?: string; fields?: BigqueryField[] };
type Cell = { v: unknown };
type Row = { f?: Cell[] };

export type BigqueryDryRun = {
  statementType: string | null;
  referencedTables: BigqueryTableRef[] | null;
  totalBytesProcessed: number;
};

/**
 * Plan a statement without running it (`jobs.insert`, `dryRun: true`): what
 * kind of statement BigQuery reads it as, the tables it reads, and the bytes
 * it would process.
 * @param creds - The service account.
 * @param input - The statement and where it runs.
 * @param input.query - The SQL.
 * @param input.location - The job location, when the source names one.
 * @param doFetch - The network.
 */
export async function dryRunQuery(creds: BigqueryCredentials, input: { query: string; location?: string }, doFetch: BigqueryFetch = fetch): Promise<BigqueryDryRun> {
  const job = await bigqueryCall<{ statistics?: { totalBytesProcessed?: string; query?: { statementType?: string; referencedTables?: BigqueryTableRef[]; totalBytesProcessed?: string } } }>(creds, {
    method: 'POST',
    path: `/projects/${encodeURIComponent(creds.projectId)}/jobs`,
    scope: DRY_RUN_SCOPE,
    body: {
      configuration: { dryRun: true, query: { query: input.query, useLegacySql: false } },
      jobReference: { projectId: creds.projectId, ...(input.location ? { location: input.location } : {}) },
    },
  }, doFetch);
  const query = job.statistics?.query;
  return {
    statementType: query?.statementType ?? null,
    referencedTables: query?.referencedTables ?? null,
    totalBytesProcessed: Number(query?.totalBytesProcessed ?? job.statistics?.totalBytesProcessed ?? 0) || 0,
  };
}

export type BigqueryJobRef = { projectId: string; jobId: string; location?: string };

export type BigqueryQueryPage = {
  jobComplete?: boolean;
  jobReference?: BigqueryJobRef;
  schema?: { fields?: BigqueryField[] };
  rows?: Row[];
  totalRows?: string;
  pageToken?: string;
  totalBytesProcessed?: string;
  totalBytesBilled?: string;
};

/**
 * Start a query and wait up to `timeoutMs` for its first page (`jobs.query`,
 * read-only scope).
 * @param creds - The service account.
 * @param input - The statement and its caps.
 * @param input.query - The SQL.
 * @param input.location - The job location, when named.
 * @param input.maxResults - Rows on the first page.
 * @param input.timeoutMs - How long this call waits.
 * @param input.maximumBytesBilled - BigQuery fails the job past this.
 * @param doFetch - The network.
 */
export async function startQuery(creds: BigqueryCredentials, input: { query: string; location?: string; maxResults: number; timeoutMs: number; maximumBytesBilled: number }, doFetch: BigqueryFetch = fetch): Promise<BigqueryQueryPage> {
  return bigqueryCall<BigqueryQueryPage>(creds, {
    method: 'POST',
    path: `/projects/${encodeURIComponent(creds.projectId)}/queries`,
    body: {
      query: input.query,
      useLegacySql: false,
      maxResults: input.maxResults,
      timeoutMs: input.timeoutMs,
      maximumBytesBilled: String(input.maximumBytesBilled),
      formatOptions: { useInt64Timestamp: true },
      labels: { source: 'vocion' },
      ...(input.location ? { location: input.location } : {}),
    },
  }, doFetch);
}

/**
 * The next page of a query job's results, waiting up to `timeoutMs` for it
 * to finish (`jobs.getQueryResults`).
 * @param creds - The service account.
 * @param job - The job.
 * @param input - Paging and waiting.
 * @param input.pageToken - The page to read.
 * @param input.maxResults - Rows on the page.
 * @param input.timeoutMs - How long this call waits.
 * @param doFetch - The network.
 */
export async function queryResults(creds: BigqueryCredentials, job: BigqueryJobRef, input: { pageToken?: string; maxResults: number; timeoutMs: number }, doFetch: BigqueryFetch = fetch): Promise<BigqueryQueryPage> {
  return bigqueryCall<BigqueryQueryPage>(creds, {
    path: `/projects/${encodeURIComponent(job.projectId)}/queries/${encodeURIComponent(job.jobId)}`,
    query: {
      'maxResults': String(input.maxResults),
      'timeoutMs': String(input.timeoutMs),
      'pageToken': input.pageToken,
      'location': job.location,
      'formatOptions.useInt64Timestamp': 'true',
    },
  }, doFetch);
}

/**
 * Cancel a running job. Best effort: a job that finished meanwhile is fine.
 * Cancelling needs `jobs.cancel`, which takes no read-only scope; it stops
 * work, it writes no data.
 * @param creds - The service account.
 * @param job - The job.
 * @param doFetch - The network.
 */
export async function cancelJob(creds: BigqueryCredentials, job: BigqueryJobRef, doFetch: BigqueryFetch = fetch): Promise<void> {
  try {
    await bigqueryCall(creds, {
      method: 'POST',
      path: `/projects/${encodeURIComponent(job.projectId)}/jobs/${encodeURIComponent(job.jobId)}/cancel`,
      query: { location: job.location },
      scope: DRY_RUN_SCOPE,
    }, doFetch);
  } catch (err) {
    console.warn('[bigquery] could not cancel a job past its timeout', { jobId: job.jobId, error: (err as Error).message });
  }
}

/**
 * The tables and views in one dataset, up to `limit`.
 * @param creds - The service account.
 * @param project - The dataset's project.
 * @param dataset - The dataset.
 * @param limit - Most to list.
 * @param doFetch - The network.
 */
export async function listTables(creds: BigqueryCredentials, project: string, dataset: string, limit = 1000, doFetch: BigqueryFetch = fetch): Promise<Array<{ tableId: string; type: string }>> {
  const out: Array<{ tableId: string; type: string }> = [];
  let pageToken: string | undefined;
  do {
    const page = await bigqueryCall<{ tables?: Array<{ tableReference?: { tableId?: string }; type?: string }>; nextPageToken?: string }>(creds, {
      path: `/projects/${encodeURIComponent(project)}/datasets/${encodeURIComponent(dataset)}/tables`,
      query: { maxResults: String(Math.min(1000, limit)), pageToken },
    }, doFetch);
    for (const t of page.tables ?? []) {
      if (t.tableReference?.tableId) {
        out.push({ tableId: t.tableReference.tableId, type: t.type ?? 'TABLE' });
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken && out.length < limit);
  return out.slice(0, limit);
}

export type BigqueryTable = { type?: string; description?: string; numRows?: string; schema?: { fields?: BigqueryField[] } };

/**
 * One table's metadata and schema.
 * @param creds - The service account.
 * @param ref - The table.
 * @param doFetch - The network.
 */
export async function getTable(creds: BigqueryCredentials, ref: BigqueryTableRef, doFetch: BigqueryFetch = fetch): Promise<BigqueryTable> {
  return bigqueryCall<BigqueryTable>(creds, {
    path: `/projects/${encodeURIComponent(ref.projectId)}/datasets/${encodeURIComponent(ref.datasetId)}/tables/${encodeURIComponent(ref.tableId)}`,
  }, doFetch);
}

/**
 * Whether a dataset exists and this service account can see it.
 * @param creds - The service account.
 * @param project - The dataset's project.
 * @param dataset - The dataset.
 * @param doFetch - The network.
 */
export async function getDataset(creds: BigqueryCredentials, project: string, dataset: string, doFetch: BigqueryFetch = fetch): Promise<{ location?: string }> {
  return bigqueryCall<{ location?: string }>(creds, { path: `/projects/${encodeURIComponent(project)}/datasets/${encodeURIComponent(dataset)}` }, doFetch);
}

/**
 * A number as JSON can carry it: a number when it round-trips exactly, else
 * the string BigQuery sent (an INT64 past 2^53, a NUMERIC with more digits
 * than a double holds).
 * @param raw - The cell's string.
 */
function exactNumber(raw: string): number | string {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return raw;
  }
  if (/^-?\d+$/.test(raw)) {
    return Number.isSafeInteger(n) ? n : raw;
  }
  let trimmed = raw;
  if (trimmed.includes('.')) {
    while (trimmed.endsWith('0')) {
      trimmed = trimmed.slice(0, -1);
    }
    if (trimmed.endsWith('.')) {
      trimmed = trimmed.slice(0, -1);
    }
  }
  return String(n) === trimmed ? n : raw;
}

/**
 * A TIMESTAMP cell as ISO 8601. With `useInt64Timestamp` BigQuery sends
 * microseconds since the epoch; older responses send seconds as a float.
 * @param raw - The cell's string.
 */
function timestamp(raw: string): string {
  if (/^-?\d+$/.test(raw)) {
    const micros = BigInt(raw);
    return new Date(Number(micros / BigInt(1000))).toISOString();
  }
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : raw;
}

function scalar(field: BigqueryField, v: unknown): unknown {
  if (v === null || v === undefined) {
    return null;
  }
  const type = field.type.toUpperCase();
  if (type === 'RECORD' || type === 'STRUCT') {
    const cells = (v as Row).f ?? [];
    return Object.fromEntries((field.fields ?? []).map((sub, i) => [sub.name, value(sub, cells[i]?.v)]));
  }
  const raw = String(v);
  switch (type) {
    case 'INTEGER':
    case 'INT64':
    case 'FLOAT':
    case 'FLOAT64':
    case 'NUMERIC':
    case 'BIGNUMERIC':
      return exactNumber(raw);
    case 'BOOLEAN':
    case 'BOOL':
      return raw === 'true';
    case 'TIMESTAMP':
      return timestamp(raw);
    default:
      return raw;
  }
}

function value(field: BigqueryField, v: unknown): unknown {
  if (field.mode === 'REPEATED') {
    return Array.isArray(v) ? v.map(item => scalar(field, (item as Cell).v)) : [];
  }
  return scalar(field, v);
}

/**
 * Rows as positional, JSON-safe values: numbers that fit, strings that do
 * not, booleans, ISO timestamps, a RECORD as an object and a REPEATED field
 * as an array.
 * @param fields - The result schema.
 * @param rows - The REST rows.
 */
export function convertRows(fields: readonly BigqueryField[], rows: readonly Row[]): unknown[][] {
  return rows.map(row => fields.map((field, i) => value(field, row.f?.[i]?.v)));
}
