/**
 * Snowflake against a recorded-shape SQL API: the key-pair JWT, the guard
 * (compile as a subquery, the plan's objects against the allowlist, then
 * run), the caps, the cancel at the deadline, Test connection, and two orgs
 * each spending their own key.
 */
import type { FamilySource } from '@/libs/connectors/families';
import { Buffer } from 'node:buffer';
import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jwtAccount, publicKeyFingerprint, resetSnowflakeJwtCache, runSnowflakeStatement, snowflakeCredentialsFrom, snowflakeJwt, snowflakeValue } from '@/libs/snowflake/client';
import { inspectSnowflake } from '@/libs/sources/snowflake';

const creds = vi.hoisted(() => ({ byOrg: {} as Record<string, Record<string, unknown> | null> }));
vi.mock('@/services/connectors/familyCredentials', () => ({
  familySourceCredentials: async (orgId: string) => creds.byOrg[orgId] ?? null,
  noCredentialMessage: (source: { slug: string }, vendor: string) => `The ${source.slug} source has no ${vendor} credential stored.`,
}));

const { buildSnowflakeProvider, snowflakePlanObjects, snowflakeWarehouseProvider } = await import('./snowflake');

function keyPair() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  return privateKey;
}
const KEY_A = keyPair();
const KEY_B = keyPair();

const CREDS_A = { account: 'northwind-analytics', user: 'vocion_reader', privateKey: KEY_A };
const CREDS_B = { account: 'kestrel-capital', user: 'vocion_reader', privateKey: KEY_B };

const CONFIG = { warehouse: 'ANALYST_XS', database: 'ANALYTICS', schemas: ['MARTS'], maxRows: 1000, maxResultKb: 2000, timeoutSeconds: 60 };

function plan(objects: string[]) {
  return JSON.stringify({ GlobalStats: { partitionsTotal: 1, partitionsAssigned: 1, bytesAssigned: 1024 }, Operations: [[{ id: 0, operation: 'Result' }, ...objects.map((o, i) => ({ id: i + 1, parentOperators: [0], operation: 'TableScan', objects: [o] }))]] });
}

function ok(rows: Array<Array<string | null>>, rowType: Array<{ name: string; type: string; scale?: number }>, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ statementHandle: '01b2c3d4-0000-1111-0000-000000000001', code: '090001', message: 'Statement executed successfully.', data: rows, resultSetMetaData: { numRows: rows.length, rowType, partitionInfo: [{ rowCount: rows.length }] }, ...extra }), { status: 200 });
}

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };
let calls: Call[];

function stub(handler: (call: Call) => Response | Promise<Response>) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const call = { url, init, body: init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {} };
    calls.push(call);
    return handler(call);
  }));
}

beforeEach(() => resetSnowflakeJwtCache());

afterEach(() => vi.unstubAllGlobals());

describe('the key-pair JWT', () => {
  it('names the account and user upper-cased, with the public key fingerprint', () => {
    const jwt = snowflakeJwt(CREDS_A, new Date('2026-10-08T12:00:00Z'));
    const claims = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()) as Record<string, unknown>;
    const der = createPublicKey(KEY_A).export({ type: 'spki', format: 'der' });
    const fingerprint = `SHA256:${createHash('sha256').update(der).digest('base64')}`;

    expect(publicKeyFingerprint(CREDS_A)).toBe(fingerprint);
    expect(claims.sub).toBe('NORTHWIND-ANALYTICS.VOCION_READER');
    expect(claims.iss).toBe(`NORTHWIND-ANALYTICS.VOCION_READER.${fingerprint}`);
    expect(Number(claims.exp) - Number(claims.iat)).toBe(3600);
  });

  it('drops a locator\'s region and makes other dots hyphens', () => {
    expect(jwtAccount('xy12345.us-east-1')).toBe('XY12345');
    expect(jwtAccount('xy12345.east-us-2.azure')).toBe('XY12345');
    expect(jwtAccount('northwind.analytics')).toBe('NORTHWIND-ANALYTICS');
  });

  it('refuses a bag that is not a key pair, with a sentence', () => {
    expect(snowflakeCredentialsFrom({ account: 'northwind-analytics', user: 'u' })).toMatchObject({ ok: false });
    expect(snowflakeCredentialsFrom({ account: 'northwind-analytics', user: 'u', privateKey: 'not a key' })).toMatchObject({ ok: false, message: expect.stringMatching(/PEM/) });
    expect(snowflakeCredentialsFrom({ ...CREDS_A, privateKey: KEY_A.replaceAll('\n', '\\n') })).toMatchObject({ ok: true });
  });
});

describe('values', () => {
  it('turns numbers that fit into numbers and keeps decimals and big integers as text', () => {
    expect(snowflakeValue('42', { name: 'n', type: 'fixed', scale: 0, nullable: true })).toBe(42);
    expect(snowflakeValue('12.50', { name: 'n', type: 'fixed', scale: 2, nullable: true })).toBe('12.50');
    expect(snowflakeValue('9007199254740993', { name: 'n', type: 'fixed', scale: 0, nullable: true })).toBe('9007199254740993');
    expect(snowflakeValue('true', { name: 'b', type: 'boolean', scale: null, nullable: true })).toBe(true);
    expect(snowflakeValue(null, { name: 'b', type: 'text', scale: null, nullable: true })).toBeNull();
  });
});

describe('the plan', () => {
  it('reads the objects every scan names', () => {
    expect(snowflakePlanObjects(plan(['ANALYTICS.MARTS.ORDERS', 'ANALYTICS."Finance".LEDGER']))).toEqual([
      { schema: 'ANALYTICS.MARTS', name: 'ORDERS' },
      { schema: 'ANALYTICS.Finance', name: 'LEDGER' },
    ]);
  });

  it('refuses a scan that names nothing', () => {
    expect(() => snowflakePlanObjects(JSON.stringify({ Operations: [[{ operation: 'ExternalScan' }]] }))).toThrow(/names no table/);
  });
});

describe('query under the guard', () => {
  const provider = () => buildSnowflakeProvider('snowflake', CREDS_A, CONFIG);

  it('compiles the statement as a subquery, checks the plan, then runs it as written with one statement allowed', async () => {
    stub(({ body }) => String(body.statement).startsWith('EXPLAIN')
      ? ok([[plan(['ANALYTICS.MARTS.ORDERS'])]], [{ name: 'content', type: 'text' }])
      : ok([['Northwind', '1200', '12.50'], ['Contoso', '800', '3.10']], [{ name: 'CUSTOMER', type: 'text' }, { name: 'ORDERS', type: 'fixed', scale: 0 }, { name: 'AVG', type: 'fixed', scale: 2 }]));

    const result = await provider().query('SELECT customer, count(*) AS orders, avg(total) FROM marts.orders GROUP BY 1 ORDER BY 2 DESC;', { maxRows: 50 });

    expect(String(calls[0]!.body.statement)).toMatch(/^EXPLAIN USING JSON SELECT \* FROM \(\nSELECT customer[\s\S]*\n\) AS vocion_query$/);
    expect(calls[1]!.body.statement).toBe('SELECT customer, count(*) AS orders, avg(total) FROM marts.orders GROUP BY 1 ORDER BY 2 DESC');
    expect(calls[1]!.body).toMatchObject({ timeout: 60, warehouse: 'ANALYST_XS', database: 'ANALYTICS', parameters: { MULTI_STATEMENT_COUNT: '1', ROWS_PER_RESULTSET: '51' } });
    expect((calls[1]!.init.headers as Record<string, string>)['x-snowflake-authorization-token-type']).toBe('KEYPAIR_JWT');
    expect(result.rows).toEqual([['Northwind', 1200, '12.50'], ['Contoso', 800, '3.10']]);
    expect(result.truncated).toBeNull();
    expect(result.queryId).toBe('01b2c3d4-0000-1111-0000-000000000001');
  });

  it('refuses DDL or DML, which Snowflake will not compile as a subquery, and runs nothing', async () => {
    stub(() => new Response(JSON.stringify({ code: '001003', sqlState: '42000', message: 'SQL compilation error:\nsyntax error line 2 at position 0 unexpected \'DROP\'.' }), { status: 422 }));

    await expect(provider().query('DROP TABLE marts.orders', { maxRows: 10 })).rejects.toMatchObject({ name: 'WarehouseRefusal', message: expect.stringMatching(/Only one read-only query[\s\S]*unexpected 'DROP'/) });
    expect(calls).toHaveLength(1);
  });

  it('refuses a query that reads outside the allowlist before running it', async () => {
    stub(() => ok([[plan(['ANALYTICS.MARTS.ORDERS', 'ANALYTICS.HR.SALARIES'])]], [{ name: 'content', type: 'text' }]));

    await expect(provider().query('SELECT * FROM marts.orders JOIN hr.salaries USING (id)', { maxRows: 10 })).rejects.toMatchObject({ name: 'WarehouseRefusal', message: expect.stringMatching(/ANALYTICS\.HR\.SALARIES/) });
    expect(calls).toHaveLength(1);
  });

  it('cuts at the row cap and at the byte cap', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => [`Acme ${i}`, 'x'.repeat(400)]);
    stub(({ body }) => String(body.statement).startsWith('EXPLAIN') ? ok([[plan(['ANALYTICS.MARTS.T'])]], [{ name: 'content', type: 'text' }]) : ok(rows, [{ name: 'A', type: 'text' }, { name: 'B', type: 'text' }]));

    const byRows = await provider().query('SELECT * FROM marts.t', { maxRows: 5 });

    expect(byRows.rows).toHaveLength(5);
    expect(byRows.truncated).toBe('rows');

    const tight = buildSnowflakeProvider('snowflake', CREDS_A, { ...CONFIG, maxResultKb: 1 });
    const byBytes = await tight.query('SELECT * FROM marts.t', { maxRows: 50 });

    expect(byBytes.rows.length).toBeLessThan(6);
    expect(byBytes.truncated).toBe('bytes');
  });

  it('polls a running statement and cancels it at the deadline', async () => {
    let clock = 0;
    stub(({ url }) => url.endsWith('/cancel') ? new Response('{}', { status: 200 }) : new Response(JSON.stringify({ statementHandle: '01b2c3d4-0000-1111-0000-000000000002', statementStatusUrl: '/api/v2/statements/01b2c3d4-0000-1111-0000-000000000002' }), { status: 202 }));

    await expect(runSnowflakeStatement(CREDS_A, 'SELECT 1', { timeoutSeconds: 5, sleep: async () => {
      clock += 10_000;
    }, now: () => new Date(clock) })).rejects.toThrow(/past the 5-second limit and was cancelled/);
    expect(calls.at(-1)!.url).toMatch(/\/cancel$/);
  });

  it('refuses to browse a schema outside the allowlist', async () => {
    stub(() => ok([], []));

    await expect(provider().listTables('ANALYTICS.HR')).rejects.toMatchObject({ name: 'WarehouseRefusal' });
    expect(calls).toHaveLength(0);
  });

  it('lists tables with bind parameters, never the schema spliced into SQL', async () => {
    stub(() => ok([['ORDERS', 'BASE TABLE', 'One row per order', '1200'], ['ORDERS_V', 'VIEW', null, null]], [{ name: 'TABLE_NAME', type: 'text' }]));

    const tables = await provider().listTables('marts');

    expect(calls[0]!.body.bindings).toEqual({ 1: { type: 'TEXT', value: 'ANALYTICS.INFORMATION_SCHEMA.TABLES' }, 2: { type: 'TEXT', value: 'MARTS' } });
    expect(String(calls[0]!.body.statement)).not.toContain('MARTS');
    expect(tables).toEqual([
      { schema: 'ANALYTICS.MARTS', name: 'ORDERS', kind: 'table', comment: 'One row per order', rowCount: 1200 },
      { schema: 'ANALYTICS.MARTS', name: 'ORDERS_V', kind: 'view', comment: null, rowCount: null },
    ]);
  });
});

describe('two workspaces', () => {
  it('each spends its own key pair', async () => {
    creds.byOrg = { org_northwind: CREDS_A, org_kestrel: CREDS_B };
    stub(() => ok([['1']], [{ name: '1', type: 'fixed', scale: 0 }]));
    const source = (slug: string): FamilySource => ({ id: 1, slug, kind: 'snowflake', config: CONFIG, apiTokenId: null });

    const a = await snowflakeWarehouseProvider('org_northwind', source('snowflake'));
    await a.listTables('MARTS');
    const b = await snowflakeWarehouseProvider('org_kestrel', source('snowflake'));
    await b.listTables('MARTS');

    const subOf = (call: Call) => JSON.parse(Buffer.from(String((call.init.headers as Record<string, string>).authorization).split(' ')[1]!.split('.')[1]!, 'base64url').toString()).sub;

    expect(calls[0]!.url).toMatch(/^https:\/\/northwind-analytics\.snowflakecomputing\.com\//);
    expect(subOf(calls[0]!)).toBe('NORTHWIND-ANALYTICS.VOCION_READER');
    expect(calls[1]!.url).toMatch(/^https:\/\/kestrel-capital\.snowflakecomputing\.com\//);
    expect(subOf(calls[1]!)).toBe('KESTREL-CAPITAL.VOCION_READER');
  });

  it('says where to connect one when none is stored', async () => {
    creds.byOrg = {};

    await expect(snowflakeWarehouseProvider('org_acme', { id: 2, slug: 'snowflake', kind: 'snowflake', config: CONFIG, apiTokenId: null })).rejects.toThrow(/no Snowflake credential/);
  });
});

describe('test connection', () => {
  it('reports who signed in and which allowed schemas the role sees', async () => {
    stub(({ body }) => String(body.statement).startsWith('SELECT CURRENT_USER')
      ? ok([['VOCION_READER', 'VOCION_READER_ROLE', 'ANALYST_XS']], [{ name: 'U', type: 'text' }])
      : ok([[(body.bindings as Record<string, { value: string }>)['2']!.value === 'MARTS' ? '1' : '0']], [{ name: 'C', type: 'fixed', scale: 0 }]));

    const result = await inspectSnowflake({ credentials: CREDS_A, config: { ...CONFIG, schemas: ['MARTS', 'MISSING'] } });

    expect(result.authorized).toBe(true);
    expect(result.checks.map(c => [c.key, c.ok])).toEqual([['auth', true], ['warehouse', true], ['schema:ANALYTICS.MARTS', true], ['schema:ANALYTICS.MISSING', false]]);
  });

  it('says the key pair was refused, without the key', async () => {
    stub(() => new Response(JSON.stringify({ code: '390144', message: 'JWT token is invalid.' }), { status: 401 }));

    const result = await inspectSnowflake({ credentials: CREDS_A, config: CONFIG });

    expect(result.authorized).toBe(false);
    expect(result.error).toMatch(/refused the key pair/);
    expect(result.error).not.toContain('BEGIN');
  });
});
