/**
 * The warehouse reads: present only for an agent with a warehouse source,
 * scoped to that agent's sources, every query through the source's provider
 * and its guard. The provider is mocked; the tables are invented.
 */
import type { RuntimeContext } from '../types';
import { toJsonSchema } from '@langchain/core/utils/json_schema';
import { describe, expect, it, vi } from 'vitest';
import { WarehouseRefusal } from '@/libs/warehouse/guard';

const provider = vi.hoisted(() => ({
  kind: 'snowflake',
  sourceSlug: 'snowflake',
  vendor: 'Snowflake',
  dialect: 'Snowflake SQL',
  schemas: ['ANALYTICS.MARTS'],
  limits: { maxRows: 500, maxResultBytes: 2_000_000, timeoutSeconds: 60 },
  listTables: vi.fn(async (schema: string) => [{ schema, name: 'ORDERS', kind: 'table', comment: null, rowCount: 1200 }]),
  describeTable: vi.fn(async (schema: string, table: string) => ({ table: { schema, name: table, kind: 'table', comment: null, rowCount: 1200 }, columns: [{ name: 'REGION', type: 'TEXT', nullable: true, comment: null }] })),
  query: vi.fn(async (_sql: string, _opts: { maxRows: number }) => ({ columns: [{ name: 'REGION', type: 'TEXT' }, { name: 'TOTAL', type: 'NUMBER' }], rows: [['EMEA', 120]], totalRows: 1, truncated: null, bytesScanned: 2048, queryId: '01b2c3d4-0000-0000-0000-000000000001' })),
}));
const resolved = vi.hoisted(() => ({ args: [] as unknown[], sources: [{ slug: 'snowflake', kind: 'snowflake', schemas: ['MARTS'] }] }));
vi.mock('@/services/warehouse/provider', () => ({
  warehouseProviderFor: async (_org: string, opts: unknown) => {
    resolved.args.push(opts);
    return provider;
  },
  warehouseSourcesFor: async () => resolved.sources,
}));

const { warehouseTools } = await import('./warehouseTools');

type Invokable = { name: string; schema: unknown; invoke: (input: Record<string, unknown>) => Promise<string> };

function ctxFor(sources: string[], kinds?: Record<string, string>, allowed?: string[]): RuntimeContext {
  return { orgId: 'org_1', agentSlug: 'analyst', connectorSources: sources, sourceKinds: kinds, allowedSourceSlugs: allowed, objectTypeSlugs: [], searchConfig: {}, harnessConfig: {}, emit: () => {}, citationSeq: { current: 0 } } as unknown as RuntimeContext;
}

describe('the warehouse reads', () => {
  it('exist only for an agent whose sources include a warehouse, by kind, and can be bound to a model', () => {
    expect(warehouseTools(ctxFor([]))).toHaveLength(0);
    expect(warehouseTools(ctxFor(['jira']))).toHaveLength(0);

    const tools = warehouseTools(ctxFor(['finance-dw'], { 'finance-dw': 'bigquery' })) as unknown as Invokable[];

    expect(tools.map(t => t.name)).toEqual(['warehouse_schema', 'warehouse_query']);

    for (const t of tools) {
      expect(() => toJsonSchema(t.schema as never)).not.toThrow();
    }
  });

  it('queries only over the agent\'s own warehouse sources, narrowed by the person\'s ACL', async () => {
    const [, query] = warehouseTools(ctxFor(['snowflake', 'finance-dw', 'jira'], { 'finance-dw': 'bigquery' }, ['snowflake', 'jira'])) as unknown as Invokable[];
    await query!.invoke({ sql: 'SELECT 1' });

    expect(resolved.args.at(-1)).toEqual({ sourceSlug: null, slugs: ['snowflake'] });
  });

  it('caps the rows asked for at the source\'s limit and hands back the result with its query id', async () => {
    const [, query] = warehouseTools(ctxFor(['snowflake'])) as unknown as Invokable[];
    const out = JSON.parse(await query!.invoke({ sql: 'SELECT region, SUM(amount) AS total FROM marts.orders GROUP BY 1', max_rows: 5000 }));

    expect(provider.query).toHaveBeenLastCalledWith('SELECT region, SUM(amount) AS total FROM marts.orders GROUP BY 1', { maxRows: 500 });
    expect(out).toMatchObject({ ok: true, warehouse: 'Snowflake', rows: [['EMEA', 120]], rowCount: 1, truncated: null, queryId: '01b2c3d4-0000-0000-0000-000000000001' });

    await query!.invoke({ sql: 'SELECT 1' });

    expect(provider.query).toHaveBeenLastCalledWith('SELECT 1', { maxRows: 100 });
  });

  it('says a guard refusal is a refusal, so the agent rewrites the query rather than retrying it', async () => {
    provider.query.mockRejectedValueOnce(new WarehouseRefusal('This query reads ANALYTICS.HR.SALARIES, outside the schemas this Snowflake source allows (ANALYTICS.MARTS). It was not run.'));
    const [, query] = warehouseTools(ctxFor(['snowflake'])) as unknown as Invokable[];
    const out = JSON.parse(await query!.invoke({ sql: 'SELECT * FROM hr.salaries' }));

    expect(out).toEqual({ ok: false, refused: true, error: expect.stringMatching(/It was not run/) });

    provider.query.mockRejectedValueOnce(new Error('SQL compilation error: invalid identifier \'REGON\''));

    expect(JSON.parse(await query!.invoke({ sql: 'SELECT regon FROM marts.orders' }))).toEqual({ ok: false, error: 'SQL compilation error: invalid identifier \'REGON\'' });
  });

  it('browses: the allowlist, a schema\'s tables (qualified from a bare name), a table\'s columns — and refuses a schema outside it', async () => {
    const [schema] = warehouseTools(ctxFor(['snowflake'])) as unknown as Invokable[];

    expect(JSON.parse(await schema!.invoke({}))).toMatchObject({ ok: true, warehouse: 'Snowflake', dialect: 'Snowflake SQL', schemas: ['ANALYTICS.MARTS'], limits: { maxRows: 500 } });

    expect(JSON.parse(await schema!.invoke({ schema: 'marts' }))).toMatchObject({ ok: true, schema: 'ANALYTICS.MARTS', tables: [{ name: 'ORDERS' }] });
    expect(provider.listTables).toHaveBeenLastCalledWith('ANALYTICS.MARTS');

    expect(JSON.parse(await schema!.invoke({ schema: 'ANALYTICS.MARTS', table: 'ORDERS' }))).toMatchObject({ ok: true, columns: [{ name: 'REGION' }] });

    expect(JSON.parse(await schema!.invoke({ schema: 'ANALYTICS.HR' }))).toMatchObject({ ok: false, refused: true, error: expect.stringMatching(/not one of the schemas/) });
    expect(provider.listTables).not.toHaveBeenCalledWith('ANALYTICS.HR');
  });

  it('lists the sources first when the agent reads more than one and names none', async () => {
    resolved.sources = [{ slug: 'snowflake', kind: 'snowflake', schemas: ['MARTS'] }, { slug: 'finance-dw', kind: 'bigquery', schemas: ['finance'] }];
    const [schema] = warehouseTools(ctxFor(['snowflake', 'finance-dw'], { 'finance-dw': 'bigquery' })) as unknown as Invokable[];

    expect(JSON.parse(await schema!.invoke({}))).toMatchObject({ ok: true, sources: resolved.sources });
  });
});
