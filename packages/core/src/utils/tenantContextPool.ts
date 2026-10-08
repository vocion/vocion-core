import type { PoolClient } from 'pg';
import type { ContextStatement } from '@/libs/tenantContext';
import pg from 'pg';
import { contextStatements, currentTenantContext } from '@/libs/tenantContext';

const BEGIN = /^\s*begin\b/i;

/** The statements for the code calling right now, or null for none. */
function statementsNow(): ContextStatement[] | null {
  return contextStatements(currentTenantContext());
}

/**
 * Read the SQL text out of whatever was passed to `query`.
 * @param config - The first argument `query` was given.
 */
function queryText(config: unknown): string | undefined {
  if (typeof config === 'string') {
    return config;
  }
  if (config && typeof config === 'object' && 'text' in config && typeof config.text === 'string') {
    return config.text;
  }
  return undefined;
}

/**
 * A node-postgres pool that labels each unit of work with the tenant context
 * (`libs/tenantContext.ts`), using transaction-local settings so a pooled
 * connection never carries one request's context into the next.
 *
 * - A plain query (`pool.query`), made under a context, is sent as
 *   `BEGIN; <context>; <query>; COMMIT` on one connection.
 * - A transaction (drizzle's `db.transaction` checks out a client and sends
 *   `begin`) gets the context right after its `begin`, from the context in
 *   force when it began.
 * - With no context, or none resolved yet, both go through untouched.
 *
 * Only built when `VOCION_DB_TENANT_CONTEXT=1` (`utils/DBConnection.ts`); the
 * plain `pg.Pool` is used otherwise.
 */
export class TenantContextPool extends pg.Pool {
  // node-postgres overloads `query` many ways; drizzle uses the promise form
  // with a config object and values. Anything callback-shaped is passed on.
  override query(...args: any[]): any {
    const statements = statementsNow();
    if (!statements || args.some(arg => typeof arg === 'function')) {
      return (super.query as (...a: any[]) => any)(...args);
    }
    return this.queryInContext(statements, args);
  }

  private async queryInContext(statements: ContextStatement[], args: any[]): Promise<unknown> {
    const client = await super.connect();
    let broken: Error | undefined;
    try {
      await client.query('begin');
      for (const statement of statements) {
        await client.query(statement.text, statement.values);
      }
      const result = await (client.query as (...a: any[]) => Promise<unknown>)(...args);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch((rollbackError: unknown) => {
        broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
      });
      throw error;
    } finally {
      // A connection whose rollback also failed is discarded, not reused.
      client.release(broken);
    }
  }

  override connect(): Promise<PoolClient>;
  override connect(callback: (err: Error | undefined, client: PoolClient | undefined, done: (release?: any) => void) => void): void;
  override connect(callback?: any): any {
    if (callback) {
      return super.connect(callback);
    }
    return super.connect().then(client => labelTransactions(client));
  }
}

/**
 * Make a checked-out client label each transaction it begins. Undone on
 * release, so the pool's next borrower gets a plain client.
 * @param client - The client the pool handed out.
 */
function labelTransactions(client: PoolClient): PoolClient {
  const originalQuery = client.query;
  const originalRelease = client.release;
  const send = originalQuery.bind(client) as (...a: any[]) => Promise<any>;

  client.query = (async (...args: any[]) => {
    const text = queryText(args[0]);
    const statements = text && BEGIN.test(text) ? statementsNow() : null;
    if (!statements || args.some(arg => typeof arg === 'function')) {
      return send(...args);
    }
    const result = await send(...args);
    for (const statement of statements) {
      await send(statement.text, statement.values);
    }
    return result;
  }) as typeof client.query;

  client.release = ((err?: Error | boolean) => {
    client.query = originalQuery;
    client.release = originalRelease;
    return originalRelease.call(client, err);
  }) as typeof client.release;

  return client;
}
