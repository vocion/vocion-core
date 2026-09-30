/**
 * The live stream across PROCESSES, against a real Postgres: a write made by
 * a separate OS process (standing in for the temporal worker's container)
 * reaches a subscriber in this one through the trigger, NOTIFY and a
 * listening connection — and still arrives when that connection is killed
 * mid-stream, by the ring and the reconnect.
 *
 * Opt-in, because the unit suite runs on PGlite, which is one process and
 * cannot be listened to from another. Point it at an empty database:
 *
 *   createdb vocion_live_test   # or: docker exec vocion-postgres createdb -U postgres vocion_live_test
 *   LIVE_PG_URL=postgresql://postgres:postgres@127.0.0.1:5432/vocion_live_test \
 *     npx vitest run --project unit src/libs/live/live.postgres.test.ts
 *
 * It applies the migrations to that database first.
 */
import type { LiveNotice } from './topics';
import { execFile } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const URL_ = process.env.LIVE_PG_URL;

vi.mock('@/libs/DB', async () => {
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { Pool } = await import('pg');
  const schema = await import('@/models/Schema');
  const pool = new Pool({ connectionString: process.env.LIVE_PG_URL ?? 'postgresql://unused@127.0.0.1:1/none', max: 4 });
  return { db: drizzle({ client: pool, schema }) };
});

const run = promisify(execFile);

/**
 * A write from another process: plain `pg`, no hub, no app code.
 * @param statement - The SQL it runs.
 */
async function fromAnotherProcess(statement: string): Promise<void> {
  const script = `const { Client } = require('pg');
    (async () => { const c = new Client({ connectionString: process.env.LIVE_PG_URL }); await c.connect(); await c.query(process.env.STATEMENT); await c.end(); })()
      .catch((e) => { console.error(e); process.exit(1); });`;
  await run(process.execPath, ['-e', script], { cwd: process.cwd(), env: { ...process.env, STATEMENT: statement } });
}

describe.skipIf(!URL_)('the live stream across processes (Postgres)', async () => {
  const { db } = await import('@/libs/DB');
  const { LiveHub } = await import('./hub');
  const { postgresTransport } = await import('./transport');
  const ORG = 'org_live_pg_northwind';
  let hub: InstanceType<typeof LiveHub>;
  let typeId = 0;

  beforeAll(async () => {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const { MIGRATIONS_FOLDER } = await import('@/libs/testing/migratedDatabaseSnapshot');
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    const rows = await db.execute(sql`insert into business_object_type (org_id, slug, label) values (${ORG}, 'request', 'Request')
      on conflict (org_id, slug) do update set label = excluded.label returning id`);
    typeId = Number((rows as unknown as { rows: Array<{ id: number }> }).rows[0]!.id);
    hub = new LiveHub({ db, transport: () => postgresTransport(URL_!), tailFastMs: 200, tailSlowMs: 60_000 });
  }, 120_000);

  afterAll(async () => {
    await hub?.stop();
  });

  it('a write committed by another process reaches a subscriber here, pushed, within two seconds', async () => {
    const got: Array<LiveNotice & { heardAt: number }> = [];
    hub.subscribe({ orgId: ORG, topics: new Set(['list:request']), send: n => got.push({ ...n, heardAt: Date.now() }) });
    await hub.ready();

    expect(hub.state()).toMatchObject({ transport: 'postgres', pushing: true });

    const wrote = Date.now();
    await fromAnotherProcess(`insert into business_object (org_id, type_id, title) values ('${ORG}', ${typeId}, 'Northwind rollout')`);

    await vi.waitFor(() => expect(got).toHaveLength(1), { timeout: 2_000, interval: 10 });

    expect(got[0]).toMatchObject({ kind: 'created', topics: expect.arrayContaining(['list:request']) });
    // From spawning the other process to hearing its commit; the process start is most of it.
    expect(got[0]!.heardAt - wrote).toBeLessThan(2_000);
  });

  it('still delivers when the listening connection is killed — by the ring, then the reconnect', async () => {
    const got: LiveNotice[] = [];
    hub.subscribe({ orgId: ORG, topics: new Set(['list:request']), send: n => got.push(n) });
    await hub.ready();

    await db.execute(sql`select pg_terminate_backend(pid) from pg_stat_activity where query = 'LISTEN vocion_live' and pid <> pg_backend_pid()`);
    await vi.waitFor(() => expect(hub.state().pushing).toBe(false), { timeout: 2_000, interval: 10 });
    await fromAnotherProcess(`insert into business_object (org_id, type_id, title) values ('${ORG}', ${typeId}, 'Kestrel expansion')`);

    await vi.waitFor(() => expect(got).toHaveLength(1), { timeout: 3_000, interval: 10 });
    await vi.waitFor(() => expect(hub.state().pushing).toBe(true), { timeout: 5_000, interval: 50 });

    await fromAnotherProcess(`insert into business_object (org_id, type_id, title) values ('${ORG}', ${typeId}, 'Contoso pilot')`);

    await vi.waitFor(() => expect(got).toHaveLength(2), { timeout: 2_000, interval: 10 });
  });
});
