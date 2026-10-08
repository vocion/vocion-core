/**
 * Databricks against a recorded-shape Statement Execution API: the guard
 * (plan as a subquery, the analysed plan's relations against the allowlist,
 * then run), the caps, the cancel at the deadline, Test connection, and two
 * orgs each spending their own token.
 */
import type { FamilySource } from '@/libs/connectors/families';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { databricksCredentialsFrom, databricksValue, runDatabricksStatement } from '@/libs/databricks/client';
import { inspectDatabricks } from '@/libs/sources/databricks';

const creds = vi.hoisted(() => ({ byOrg: {} as Record<string, Record<string, unknown> | null> }));
vi.mock('@/services/connectors/familyCredentials', () => ({
  familySourceCredentials: async (orgId: string) => creds.byOrg[orgId] ?? null,
  noCredentialMessage: (source: { slug: string }, vendor: string) => `The ${source.slug} source has no ${vendor} credential stored.`,
}));

const { buildDatabricksProvider, databricksPlanObjects, databricksWarehouseProvider } = await import('./databricks');

const CREDS_A = { host: 'https://dbc-1a2b3c4d-5e6f.cloud.databricks.com', token: 'dapi0000northwind0000000000000001' };
const CREDS_B = { host: 'https://dbc-9f8e7d6c-5b4a.cloud.databricks.com', token: 'dapi0000kestrel00000000000000002' };
const CONFIG = { warehouseId: '1a2b3c4d5e6f7a8b', catalog: 'main', schemas: ['marts'], maxRows: 1000, maxResultKb: 2000, timeoutSeconds: 60 };

function planText(relations: string[]): string {
  return [
    '== Parsed Logical Plan ==',
    '\'Project [*]',
    '+- \'SubqueryAlias vocion_query',
    '== Analyzed Logical Plan ==',
    'customer: string, orders: bigint',
    'Project [customer#1, orders#2L]',
    '+- SubqueryAlias vocion_query',
    '   +- Aggregate [customer#1], [customer#1, count(1) AS orders#2L]',
    ...relations.map(r => `      +- SubqueryAlias ${r}\n         +- Relation ${r}[customer#1,total#3] parquet`),
    '== Optimized Logical Plan ==',
    'Aggregate [customer#1]',
    '== Physical Plan ==',
    'PhotonScan parquet main.marts.orders',
  ].join('\n');
}

function done(rows: Array<Array<string | null>>, columns: Array<{ name: string; type_name: string }>, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ statement_id: '01ef0000-1111-2222-3333-444455556666', status: { state: 'SUCCEEDED' }, manifest: { schema: { columns }, total_row_count: rows.length, truncated: false }, result: { data_array: rows }, ...extra }), { status: 200 });
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

afterEach(() => vi.unstubAllGlobals());

describe('credential and values', () => {
  it('refuses a bag without a workspace URL or token, with a sentence', () => {
    expect(databricksCredentialsFrom({ token: 'dapi0000' })).toMatchObject({ ok: false, message: expect.stringMatching(/workspace URL/) });
    expect(databricksCredentialsFrom({ host: 'dbc-1.cloud.databricks.com', token: 'dapi0000' })).toMatchObject({ ok: false, message: expect.stringMatching(/https:\/\//) });
    expect(databricksCredentialsFrom({ ...CREDS_A, host: `${CREDS_A.host}/` })).toMatchObject({ ok: true, credentials: { host: CREDS_A.host } });
  });

  it('turns numbers that fit into numbers and keeps decimals as text', () => {
    expect(databricksValue('42', { name: 'n', type: 'BIGINT' })).toBe(42);
    expect(databricksValue('9007199254740993', { name: 'n', type: 'LONG' })).toBe('9007199254740993');
    expect(databricksValue('12.50', { name: 'n', type: 'DECIMAL' })).toBe('12.50');
    expect(databricksValue('0.5', { name: 'n', type: 'DOUBLE' })).toBe(0.5);
    expect(databricksValue('true', { name: 'b', type: 'BOOLEAN' })).toBe(true);
  });
});

describe('the analysed plan', () => {
  it('reads every relation, qualified by catalog', () => {
    expect(databricksPlanObjects(planText(['main.marts.orders', 'finance.reporting.ledger']), 'main')).toEqual([
      { schema: 'main.marts', name: 'orders' },
      { schema: 'finance.reporting', name: 'ledger' },
    ]);
  });

  it('reads a view and a two-part Hive name', () => {
    const text = '== Analyzed Logical Plan ==\nProject [a#1]\n+- View (`main`.`marts`.`orders_v`, [a#1])\n   +- Relation default.events[a#1] parquet\n== Optimized Logical Plan ==';

    expect(databricksPlanObjects(text, 'spark_catalog')).toEqual([
      { schema: 'main.marts', name: 'orders_v' },
      { schema: 'spark_catalog.default', name: 'events' },
    ]);
  });

  it('refuses a relation it cannot qualify, and a plan that failed', () => {
    expect(() => databricksPlanObjects('== Analyzed Logical Plan ==\n+- Relation [a#1] parquet\n== Optimized Logical Plan ==', 'main')).toThrow(/names no table/);
    expect(() => databricksPlanObjects('== Physical Plan ==\nError occurred during query planning: \n[TABLE_OR_VIEW_NOT_FOUND] The table or view `marts`.`nope` cannot be found.', 'main')).toThrow(/could not plan this one: \[TABLE_OR_VIEW_NOT_FOUND\]/);
  });
});

describe('query under the guard', () => {
  const provider = () => buildDatabricksProvider('databricks', CREDS_A, CONFIG);

  it('plans the statement as a subquery, checks the plan, then runs it as written with Databricks-side limits', async () => {
    stub(({ body }) => String(body.statement).startsWith('EXPLAIN')
      ? done([[planText(['main.marts.orders'])]], [{ name: 'plan', type_name: 'STRING' }])
      : done([['Northwind', '1200'], ['Contoso', '800']], [{ name: 'customer', type_name: 'STRING' }, { name: 'orders', type_name: 'LONG' }]));

    const result = await provider().query('SELECT customer, count(*) AS orders FROM marts.orders GROUP BY 1 ORDER BY 2 DESC', { maxRows: 20 });

    expect(String(calls[0]!.body.statement)).toMatch(/^EXPLAIN EXTENDED SELECT \* FROM \(\nSELECT customer[\s\S]*\n\) AS vocion_query$/);
    expect(calls[1]!.body).toMatchObject({ statement: 'SELECT customer, count(*) AS orders FROM marts.orders GROUP BY 1 ORDER BY 2 DESC', warehouse_id: '1a2b3c4d5e6f7a8b', catalog: 'main', row_limit: 21, byte_limit: 2_000_000, disposition: 'INLINE', format: 'JSON_ARRAY' });
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${CREDS_A.token}`);
    expect(result.rows).toEqual([['Northwind', 1200], ['Contoso', 800]]);
    expect(result.queryId).toBe('01ef0000-1111-2222-3333-444455556666');
  });

  it('refuses DDL or DML, which Spark will not parse as a subquery, and runs nothing', async () => {
    stub(() => new Response(JSON.stringify({ statement_id: 'x', status: { state: 'FAILED', error: { error_code: 'PARSE_SYNTAX_ERROR', message: '[PARSE_SYNTAX_ERROR] Syntax error at or near \'TABLE\'.' } } }), { status: 200 }));

    await expect(provider().query('DROP TABLE marts.orders', { maxRows: 10 })).rejects.toMatchObject({ name: 'WarehouseRefusal', message: expect.stringMatching(/Only one read-only query[\s\S]*PARSE_SYNTAX_ERROR/) });
    expect(calls).toHaveLength(1);
  });

  it('refuses a query that reads outside the allowlist before running it', async () => {
    stub(() => done([[planText(['main.marts.orders', 'main.hr.salaries'])]], [{ name: 'plan', type_name: 'STRING' }]));

    await expect(provider().query('SELECT * FROM marts.orders JOIN hr.salaries USING (id)', { maxRows: 10 })).rejects.toMatchObject({ name: 'WarehouseRefusal', message: expect.stringMatching(/main\.hr\.salaries/) });
    expect(calls).toHaveLength(1);
  });

  it('cuts at the row cap', async () => {
    stub(({ body }) => String(body.statement).startsWith('EXPLAIN')
      ? done([[planText(['main.marts.orders'])]], [{ name: 'plan', type_name: 'STRING' }])
      : done(Array.from({ length: 6 }, (_, i) => [`Acme ${i}`]), [{ name: 'c', type_name: 'STRING' }], { manifest: { schema: { columns: [{ name: 'c', type_name: 'STRING' }] }, total_row_count: 6, truncated: true } }));

    const result = await provider().query('SELECT c FROM marts.orders', { maxRows: 5 });

    expect(result.rows).toHaveLength(5);
    expect(result.truncated).toBe('rows');
    expect(result.totalRows).toBeNull();
  });

  it('polls a running statement and cancels it at the deadline', async () => {
    let clock = 0;
    stub(({ url }) => url.endsWith('/cancel') ? new Response('{}') : new Response(JSON.stringify({ statement_id: '01ef0000-aaaa', status: { state: 'RUNNING' } })));

    await expect(runDatabricksStatement(CREDS_A, 'SELECT 1', { warehouseId: 'w', timeoutSeconds: 5, sleep: async () => {
      clock += 10_000;
    }, now: () => clock })).rejects.toThrow(/past the 5-second limit and was cancelled/);
    expect(calls.at(-1)!.url).toMatch(/\/api\/2\.0\/sql\/statements\/01ef0000-aaaa\/cancel$/);
  });

  it('lists tables with a named parameter, never the agent\'s text spliced in', async () => {
    stub(() => done([['orders', 'MANAGED', 'One row per order'], ['orders_v', 'VIEW', null]], [{ name: 'table_name', type_name: 'STRING' }]));

    const tables = await provider().listTables('MARTS');

    expect(calls[0]!.body.parameters).toEqual([{ name: 'schema', value: 'marts', type: 'STRING' }]);
    expect(String(calls[0]!.body.statement)).toContain('`main`.information_schema.tables');
    expect(tables.map(t => [t.name, t.kind])).toEqual([['orders', 'table'], ['orders_v', 'view']]);
    await expect(provider().listTables('hr')).rejects.toMatchObject({ name: 'WarehouseRefusal' });
  });
});

describe('two workspaces', () => {
  it('each spends its own token against its own workspace', async () => {
    creds.byOrg = { org_northwind: CREDS_A, org_kestrel: CREDS_B };
    stub(() => done([], [{ name: 'table_name', type_name: 'STRING' }]));
    const source: FamilySource = { id: 1, slug: 'databricks', kind: 'databricks', config: CONFIG, apiTokenId: null };

    await (await databricksWarehouseProvider('org_northwind', source)).listTables('marts');
    await (await databricksWarehouseProvider('org_kestrel', source)).listTables('marts');

    expect(calls[0]!.url.startsWith(CREDS_A.host)).toBe(true);
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${CREDS_A.token}`);
    expect(calls[1]!.url.startsWith(CREDS_B.host)).toBe(true);
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${CREDS_B.token}`);
  });
});

describe('test connection', () => {
  it('reads the warehouse, runs SELECT 1, and checks each allowed schema', async () => {
    stub(({ url, body }) => url.includes('/sql/warehouses/')
      ? new Response(JSON.stringify({ id: CONFIG.warehouseId, name: 'Analyst XS', state: 'RUNNING' }))
      : String(body.statement) === 'SELECT 1'
        ? done([['1']], [{ name: '1', type_name: 'INT' }])
        : done([[(body.parameters as Array<{ value: string }>)[0]!.value === 'marts' ? '1' : '0']], [{ name: 'c', type_name: 'LONG' }]));

    const result = await inspectDatabricks({ credentials: CREDS_A, config: { ...CONFIG, schemas: ['marts', 'missing'] } });

    expect(result.checks.map(c => [c.key, c.ok])).toEqual([['warehouse', true], ['query', true], ['schema:main.marts', true], ['schema:main.missing', false]]);
  });

  it('says the token was refused, without the token', async () => {
    stub(() => new Response(JSON.stringify({ error_code: 'PERMISSION_DENIED', message: 'Invalid access token.' }), { status: 403 }));

    const result = await inspectDatabricks({ credentials: CREDS_A, config: CONFIG });

    expect(result.authorized).toBe(false);
    expect(result.error).toMatch(/refused the token/);
    expect(result.error).not.toContain(CREDS_A.token);
  });
});
