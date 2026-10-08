import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAsSystem, runWithTenantScope, setRequestTenant } from '@/libs/tenantContext';
import { TenantContextPool } from './tenantContextPool';

// Runs only against a real Postgres: TENANT_CONTEXT_PG_URL=postgres://… (a
// throwaway database; it only reads settings and creates nothing).
const URL = process.env.TENANT_CONTEXT_PG_URL;

describe.skipIf(!URL)('the tenant-context pool', () => {
  let pool: TenantContextPool;
  let db: ReturnType<typeof drizzle>;

  const settings = async (run: () => Promise<{ rows: Record<string, unknown>[] }>) => (await run()).rows[0];
  const readSettings = sql`select current_setting('app.account_id', true) as account, current_setting('app.user_id', true) as "user", current_setting('app.context', true) as ctx`;

  beforeAll(() => {
    pool = new TenantContextPool({ connectionString: URL, max: 2 });
    db = drizzle({ client: pool });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('sends a query untouched with no context', async () => {
    const row = await settings(() => db.execute(readSettings));

    expect(row?.account ?? '').toBe('');
    expect(row?.ctx ?? '').toBe('');
  });

  it('labels a plain query with the request tenant', async () => {
    const row = await runWithTenantScope(async () => {
      setRequestTenant({ accountId: 'acct_northwind', userId: 'user_1' });
      return settings(() => db.execute(readSettings));
    });

    expect(row).toEqual({ account: 'acct_northwind', user: 'user_1', ctx: 'tenant' });
  });

  it('labels a transaction once, after its begin, and the label ends with it', async () => {
    const inside = await runWithTenantScope(async () => {
      setRequestTenant({ accountId: 'acct_kestrel' });
      return db.transaction(async (tx) => {
        const first = await settings(() => tx.execute(readSettings));
        const second = await settings(() => tx.execute(readSettings));
        return [first, second];
      });
    });

    expect(inside).toEqual([
      { account: 'acct_kestrel', user: '', ctx: 'tenant' },
      { account: 'acct_kestrel', user: '', ctx: 'tenant' },
    ]);

    // The same pooled connections, outside any scope: nothing left behind.
    const after = await Promise.all([db.execute(readSettings), db.execute(readSettings)]);
    for (const result of after) {
      expect(result.rows[0]?.account ?? '').toBe('');
    }
  });

  it('labels system work as system, with no tenant', async () => {
    const row = await runAsSystem('test', () => settings(() => db.execute(readSettings)));

    expect(row).toEqual({ account: '', user: '', ctx: 'system' });
  });

  it('rolls back and still returns the connection when a labelled query fails', async () => {
    await runWithTenantScope(async () => {
      setRequestTenant({ accountId: 'acct_contoso' });

      await expect(db.execute(sql`select 1/0`)).rejects.toThrow();

      const row = await settings(() => db.execute(readSettings));

      expect(row?.account).toBe('acct_contoso');
    });
  });
});
