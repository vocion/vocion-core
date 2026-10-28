import { sql } from 'drizzle-orm';
import { Client, Pool } from 'pg';
import { db } from '@/libs/DB';

type Locked<T> = { ran: true; value: T } | { ran: false };

/** Locks this process holds: Postgres hands a session's own lock back to it, so the process guards itself. */
const held = new Set<string>();

/**
 * Run `fn` only if no other process holds the Postgres advisory lock `name`;
 * otherwise do nothing and say so. The lock is held for the whole of `fn` and
 * released after it, or by Postgres when the process dies.
 *
 * An advisory lock belongs to the connection that took it, and every query
 * here comes off a pool, so on a pool the lock is taken on a connection of its
 * own, outside it: the work inside `fn` still uses the pool (a local pool of
 * one connection would otherwise wait on itself). PGlite has one connection,
 * and the lock is taken on it. Either way a second call in this process while
 * the first runs does nothing too.
 * @param name - The lock's name; hashed to Postgres' key.
 * @param fn - The work only one process may do at a time.
 */
export async function withAdvisoryLock<T>(name: string, fn: () => Promise<T>): Promise<Locked<T>> {
  if (held.has(name)) {
    return { ran: false };
  }
  held.add(name);
  try {
    return await takeAndRun(name, fn);
  } finally {
    held.delete(name);
  }
}

async function takeAndRun<T>(name: string, fn: () => Promise<T>): Promise<Locked<T>> {
  const client = (db as unknown as { $client?: unknown }).$client;
  if (client instanceof Pool) {
    const conn = new Client((client as unknown as { options: ConstructorParameters<typeof Client>[0] }).options);
    await conn.connect();
    try {
      const { rows } = await conn.query<{ got: boolean }>('select pg_try_advisory_lock(hashtext($1)) as got', [name]);
      if (!rows[0]?.got) {
        return { ran: false };
      }
      return { ran: true, value: await fn() };
    } finally {
      // Closing the connection releases the lock with it.
      await conn.end().catch(() => {});
    }
  }
  const got = await db.execute(sql`select pg_try_advisory_lock(hashtext(${name})) as got`) as unknown as { rows: Array<{ got: boolean }> };
  if (!got.rows[0]?.got) {
    return { ran: false };
  }
  try {
    return { ran: true, value: await fn() };
  } finally {
    await db.execute(sql`select pg_advisory_unlock(hashtext(${name}))`).catch(() => {});
  }
}
