/**
 * Snowflake SQL API v2 client — the one place that knows how to talk to a
 * Snowflake account: the key-pair JWT, the statement submit, the 202 poll,
 * the partition read and the cancel.
 *
 * Facts this file depends on (docs.snowflake.com/en/developer-guide/sql-api):
 *   - `POST /api/v2/statements` takes `statement`, `timeout` (seconds; the
 *     engine cancels the statement past it), `warehouse`, `database`, `role`,
 *     `bindings` and a `parameters` object whose allowed session parameters
 *     include `MULTI_STATEMENT_COUNT` and `ROWS_PER_RESULTSET`.
 *   - 200 carries the first partition (`data`, every value a string or null)
 *     and `resultSetMetaData` (`numRows`, `rowType`, `partitionInfo`); 202 and
 *     408 mean still running (poll `GET /api/v2/statements/{handle}`); 422 is
 *     a failure whose `message` is the engine's. A later partition is
 *     `GET /api/v2/statements/{handle}?partition=N`; a cancel is
 *     `POST /api/v2/statements/{handle}/cancel`.
 *   - Key-pair auth is `Authorization: Bearer <JWT>` with
 *     `X-Snowflake-Authorization-Token-Type: KEYPAIR_JWT`. The JWT is RS256,
 *     `iss` = `<ACCOUNT>.<USER>.SHA256:<fingerprint>`, `sub` = `<ACCOUNT>.<USER>`,
 *     account and user upper-cased, a locator's region dropped and any other
 *     dot made a hyphen; the fingerprint is base64 SHA-256 of the public key's
 *     DER; Snowflake honours at most one hour.
 *
 * Errors are thrown as `SnowflakeError`, written for a person, never carrying
 * the JWT or the key. Nothing is cached but the signed JWT, keyed by a digest
 * of the exact credential, so one workspace's token can never answer another's.
 */

import { Buffer } from 'node:buffer';
import { createHash, createPrivateKey, createPublicKey, randomUUID, sign } from 'node:crypto';

export type SnowflakeCredentials = {
  /** The account identifier as typed: `northwind-analytics` or `xy12345.us-east-1`. */
  account: string;
  user: string;
  privateKey: string;
  privateKeyPassphrase?: string;
};

export type SnowflakeContext = { warehouse?: string; database?: string; role?: string };

export type SnowflakeColumn = { name: string; type: string; scale: number | null; nullable: boolean | null };

export type SnowflakeResult = {
  handle: string | null;
  columns: SnowflakeColumn[];
  /** Raw rows as Snowflake sent them: strings or null. */
  rows: Array<Array<string | null>>;
  numRows: number | null;
  partitions: number;
};

export class SnowflakeError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'SnowflakeError';
    this.status = status;
  }
}

type Fetch = typeof fetch;

/**
 * The credential bag as a typed credential, or why it cannot be used.
 * @param bag - The decrypted credential values.
 */
export function snowflakeCredentialsFrom(bag: Record<string, unknown> | null | undefined): { ok: true; credentials: SnowflakeCredentials } | { ok: false; message: string } {
  const str = (key: string) => (typeof bag?.[key] === 'string' ? (bag[key] as string).trim() : '');
  const account = str('account').replace(/\.snowflakecomputing\.com.*$/i, '').replace(/^https?:\/\//i, '');
  const user = str('user');
  const privateKey = str('privateKey').replaceAll('\\n', '\n');
  if (!account || !user || !privateKey) {
    return { ok: false, message: 'The Snowflake credential needs the account identifier, the user and the user\'s private key. Paste all three on the Connections page.' };
  }
  if (!/-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----/.test(privateKey)) {
    return { ok: false, message: 'The stored Snowflake private key is not a PEM private key. Re-paste it, beginning -----BEGIN PRIVATE KEY-----.' };
  }
  const passphrase = str('privateKeyPassphrase');
  return { ok: true, credentials: { account, user, privateKey, ...(passphrase ? { privateKeyPassphrase: passphrase } : {}) } };
}

/**
 * The account as the JWT names it: upper-cased, a locator's region dropped
 * (`xy12345.us-east-1` → `XY12345`), any other dot made a hyphen.
 * @param account - The account identifier as typed.
 */
export function jwtAccount(account: string): string {
  const parts = account.split('.');
  const looksLikeLocatorRegion = parts.length > 1 && (parts.length > 2 || /^[a-z]+-[a-z]+(?:-\d+)?$/i.test(parts[1]!) || /^(?:aws|azure|gcp)$/i.test(parts.at(-1)!));
  const base = looksLikeLocatorRegion ? parts[0]! : parts.join('-');
  return base.toUpperCase();
}

/**
 * The account's SQL API host.
 * @param account - The account identifier as typed.
 */
export function snowflakeHost(account: string): string {
  return `https://${account.toLowerCase().replaceAll('_', '-')}.snowflakecomputing.com`;
}

/**
 * The `SHA256:<base64>` fingerprint of the public half of a private key.
 * @param credentials - The credential holding the private key.
 */
export function publicKeyFingerprint(credentials: SnowflakeCredentials): string {
  const key = privateKeyObject(credentials);
  const der = createPublicKey(key).export({ type: 'spki', format: 'der' });
  return `SHA256:${createHash('sha256').update(der).digest('base64')}`;
}

function privateKeyObject(credentials: SnowflakeCredentials) {
  try {
    return createPrivateKey({ key: credentials.privateKey, format: 'pem', ...(credentials.privateKeyPassphrase ? { passphrase: credentials.privateKeyPassphrase } : {}) });
  } catch {
    // The crypto error can quote key material; it is replaced, not passed on.
    throw new SnowflakeError(credentials.privateKeyPassphrase
      ? 'The stored Snowflake private key could not be opened with its passphrase. Re-paste the key and the passphrase it was encrypted with.'
      : 'The stored Snowflake private key could not be read. If it is encrypted (BEGIN ENCRYPTED PRIVATE KEY), add its passphrase; otherwise re-paste it.', null);
  }
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

/**
 * A signed key-pair JWT for the credential, valid for one hour from `now`.
 * @param credentials - The credential.
 * @param now - The clock.
 */
export function snowflakeJwt(credentials: SnowflakeCredentials, now: Date = new Date()): string {
  const qualified = `${jwtAccount(credentials.account)}.${credentials.user.toUpperCase()}`;
  const iat = Math.floor(now.getTime() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: `${qualified}.${publicKeyFingerprint(credentials)}`, sub: qualified, iat, exp: iat + 3600 }));
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), privateKeyObject(credentials));
  return `${header}.${claims}.${b64url(signature)}`;
}

/** Signed JWTs, keyed by a digest of the exact credential that signed them. */
const jwtCache = new Map<string, { jwt: string; expiresAt: number }>();

function credentialDigest(c: SnowflakeCredentials): string {
  return createHash('sha256').update(c.account).update('\0').update(c.user).update('\0').update(c.privateKey).update('\0').update(c.privateKeyPassphrase ?? '').digest('hex');
}

function jwtFor(c: SnowflakeCredentials, now: Date): string {
  const digest = credentialDigest(c);
  const cached = jwtCache.get(digest);
  if (cached && cached.expiresAt > now.getTime() + 5 * 60_000) {
    return cached.jwt;
  }
  const jwt = snowflakeJwt(c, now);
  jwtCache.set(digest, { jwt, expiresAt: now.getTime() + 3600_000 });
  return jwt;
}

/** Drop every cached JWT. Test seam. */
export function resetSnowflakeJwtCache(): void {
  jwtCache.clear();
}

type StatementBody = {
  statementHandle?: string;
  statementStatusUrl?: string;
  message?: string;
  code?: string;
  sqlState?: string;
  data?: Array<Array<string | null>>;
  resultSetMetaData?: {
    numRows?: number;
    rowType?: Array<{ name?: string; type?: string; scale?: number | null; nullable?: boolean }>;
    partitionInfo?: Array<{ rowCount?: number }>;
  };
};

export type SnowflakeRunOptions = {
  context?: SnowflakeContext;
  /** Seconds the engine may run the statement; Snowflake cancels it past this. */
  timeoutSeconds: number;
  /** Rows to read back at most; partitions past it are not fetched. */
  maxRows?: number;
  /** Bind values for `?` placeholders, as text. */
  bindings?: string[];
  doFetch?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

function headers(c: SnowflakeCredentials, now: Date): Record<string, string> {
  return {
    'authorization': `Bearer ${jwtFor(c, now)}`,
    'x-snowflake-authorization-token-type': 'KEYPAIR_JWT',
    'accept': 'application/json',
    'content-type': 'application/json',
    'user-agent': 'Vocion/1.0',
  };
}

async function readBody(res: Response): Promise<StatementBody> {
  try {
    return await res.json() as StatementBody;
  } catch {
    return {};
  }
}

function failure(status: number, body: StatementBody): SnowflakeError {
  if (status === 401 || status === 403) {
    return new SnowflakeError(`Snowflake refused the key pair (HTTP ${status})${body.message ? `: ${body.message}` : ''}. Check the account identifier, the user, and that the user's RSA_PUBLIC_KEY matches the stored private key.`, status);
  }
  if (status === 404) {
    return new SnowflakeError('Snowflake has no such account at that identifier. Check the part of the address before .snowflakecomputing.com.', status);
  }
  if (status === 429) {
    return new SnowflakeError('Snowflake is rate-limiting this account; try again in a minute.', status);
  }
  return new SnowflakeError(body.message ? `Snowflake: ${body.message}` : `Snowflake answered HTTP ${status}.`, status);
}

/**
 * Run one statement and read back its rows: submit, poll while it runs,
 * cancel it at the deadline, read partitions up to `maxRows`.
 * @param c - The credential.
 * @param statement - The SQL.
 * @param opts - Context, limits and test seams.
 */
export async function runSnowflakeStatement(c: SnowflakeCredentials, statement: string, opts: SnowflakeRunOptions): Promise<SnowflakeResult> {
  const doFetch = opts.doFetch ?? fetch;
  const sleep = opts.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const now = opts.now ?? (() => new Date());
  const host = snowflakeHost(c.account);
  const deadline = now().getTime() + (opts.timeoutSeconds + 15) * 1000;
  const parameters: Record<string, string> = { MULTI_STATEMENT_COUNT: '1', QUERY_TAG: 'vocion' };
  if (opts.maxRows) {
    // One past the cap, so a cut is visible.
    parameters.ROWS_PER_RESULTSET = String(opts.maxRows + 1);
  }
  const body = {
    statement,
    timeout: opts.timeoutSeconds,
    ...(opts.context?.warehouse ? { warehouse: opts.context.warehouse } : {}),
    ...(opts.context?.database ? { database: opts.context.database } : {}),
    ...(opts.context?.role ? { role: opts.context.role } : {}),
    ...(opts.bindings?.length ? { bindings: Object.fromEntries(opts.bindings.map((value, i) => [String(i + 1), { type: 'TEXT', value }])) } : {}),
    parameters,
  };
  let res: Response;
  try {
    res = await doFetch(`${host}/api/v2/statements?requestId=${randomUUID()}`, { method: 'POST', headers: headers(c, now()), body: JSON.stringify(body) });
  } catch {
    throw new SnowflakeError(`Snowflake could not be reached at ${host}. Check the account identifier.`, null);
  }
  let payload = await readBody(res);
  let status = res.status;
  const handle = payload.statementHandle ?? null;
  while (status === 202 || status === 408) {
    if (now().getTime() >= deadline) {
      if (handle) {
        await doFetch(`${host}/api/v2/statements/${encodeURIComponent(handle)}/cancel`, { method: 'POST', headers: headers(c, now()) }).catch(() => undefined);
      }
      throw new SnowflakeError(`The statement ran past the ${opts.timeoutSeconds}-second limit and was cancelled. Narrow it (a WHERE on a date, fewer columns) or aggregate.`, null);
    }
    await sleep(1000);
    const poll = await doFetch(`${host}/api/v2/statements/${encodeURIComponent(handle ?? '')}`, { method: 'GET', headers: headers(c, now()) });
    status = poll.status;
    payload = await readBody(poll);
  }
  if (status !== 200) {
    throw failure(status, payload);
  }
  const meta = payload.resultSetMetaData ?? {};
  const columns = (meta.rowType ?? []).map(col => ({ name: col.name ?? '', type: col.type ?? 'text', scale: typeof col.scale === 'number' ? col.scale : null, nullable: typeof col.nullable === 'boolean' ? col.nullable : null }));
  const rows = [...(payload.data ?? [])];
  const partitions = meta.partitionInfo?.length ?? 1;
  const cap = opts.maxRows ? opts.maxRows + 1 : Number.POSITIVE_INFINITY;
  const toRead = handle === null ? 1 : partitions;
  for (let p = 1; p < toRead && rows.length < cap; p++) {
    const part = await doFetch(`${host}/api/v2/statements/${encodeURIComponent(handle ?? '')}?partition=${p}`, { method: 'GET', headers: headers(c, now()) });
    const partBody = await readBody(part);
    if (part.status !== 200) {
      throw failure(part.status, partBody);
    }
    rows.push(...(partBody.data ?? []));
  }
  return { handle, columns, rows, numRows: typeof meta.numRows === 'number' ? meta.numRows : null, partitions };
}

/**
 * A Snowflake value as a JSON-safe scalar: numbers that fit, booleans, and
 * everything else (decimals with a scale, big integers, dates) as Snowflake's text.
 * @param value - The cell as Snowflake sent it.
 * @param column - Its column.
 */
export function snowflakeValue(value: string | null, column: SnowflakeColumn | undefined): unknown {
  if (value === null || !column) {
    return value;
  }
  const type = column.type.toLowerCase();
  if (type === 'boolean') {
    return value === 'true' || value === '1' ? true : value === 'false' || value === '0' ? false : value;
  }
  if (type === 'real' || (type === 'fixed' && (column.scale ?? 0) === 0)) {
    const n = Number(value);
    return Number.isFinite(n) && (type === 'real' || Number.isSafeInteger(n)) ? n : value;
  }
  return value;
}

/**
 * An object name as SQL: bare when Snowflake would read it unquoted (and so
 * upper-case it), double-quoted otherwise. Only ever a name an admin typed
 * into the source's settings, never an agent's text.
 * @param name - A database or schema name.
 */
export function snowflakeIdentifier(name: string): string {
  return /^[A-Z_][\w$]*$/i.test(name) ? name : `"${name.replaceAll('"', '""')}"`;
}
