/**
 * The access log's writer: what a read becomes as a row, that a read never
 * waits on or fails with its row, that nothing is dropped without saying so,
 * and that the table is append-only.
 */
import process from 'node:process';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accessEventSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const {
  accessLogStats,
  flushAccessLog,
  KEEP_FAILED_MS,
  noteCallerRead,
  noteLinkRead,
  notePersonRead,
  noteRead,
  recordAccess,
  resetAccessLogForTests,
  withAccessScope,
} = await import('./accessLog');

const ACCOUNT = 'acct_access_northwind';
const ORG = 'proj_access_northwind';
const OTHER = 'proj_access_kestrel';

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

async function rows(orgId = ORG) {
  return db.select().from(accessEventSchema).where(eq(accessEventSchema.orgId, orgId));
}

beforeEach(async () => {
  resetAccessLogForTests();
  vi.stubEnv('AUTH_SECRET', 'test-secret-test-secret-test-secret');
  await db.delete(accessEventSchema);
  await db.delete(projectSchema).where(eq(projectSchema.id, ORG));
  await db.delete(tenantAccountSchema).where(eq(tenantAccountSchema.id, ACCOUNT));
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Northwind', slug: 'northwind-access' });
  await db.insert(projectSchema).values({ id: ORG, accountId: ACCOUNT, slug: 'northwind-access', name: 'Northwind' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** The database refusing to answer at all: inserts and the liveness probe both fail. */
function databaseDown() {
  const insert = vi.spyOn(db, 'insert').mockImplementation(() => {
    throw new Error('database unreachable');
  });
  const probe = vi.spyOn(db, 'execute').mockImplementation(() => {
    throw new Error('database unreachable');
  });
  return () => {
    insert.mockRestore();
    probe.mockRestore();
  };
}

describe('recordAccess + flushAccessLog', () => {
  it('writes a person\'s read as one row, with the workspace\'s account filled in', async () => {
    recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: 'object', id: 12 }, via: 'page' });

    // Nothing is written until the batch goes: the read did not wait.
    expect(await rows()).toHaveLength(0);
    expect(accessLogStats().pending).toBe(1);

    const stats = await flushAccessLog();

    expect(stats).toMatchObject({ written: 1, dropped: 0, pending: 0 });

    const [row] = await rows();

    expect(row).toMatchObject({
      orgId: ORG,
      accountId: ACCOUNT,
      actorKind: 'user',
      actorId: 'usr-dana',
      onBehalfOf: null,
      action: 'view',
      recordKind: 'object',
      recordId: '12',
      via: 'page',
    });
    expect(row!.at).toBeInstanceOf(Date);
  });

  it('writes an agent\'s read with the run it was on and who it was for', async () => {
    recordAccess({
      orgId: ORG,
      actor: { kind: 'agent', agentSlug: 'revenue-lead', onBehalfOf: 'usr-dana', run: { kind: 'mission_run', id: 5974 } },
      action: 'search',
      record: { kind: 'document' },
      via: 'tool:search_knowledge',
      detail: { hits: 7 },
    });
    await flushAccessLog();

    expect((await rows())[0]).toMatchObject({
      actorKind: 'agent',
      actorId: 'revenue-lead',
      onBehalfOf: 'usr-dana',
      runKind: 'mission_run',
      runId: '5974',
      action: 'search',
      recordKind: 'document',
      recordId: null,
      detail: { hits: 7 },
    });
  });

  it('batches many reads into one write', async () => {
    const insert = vi.spyOn(db, 'insert');
    for (let i = 1; i <= 25; i++) {
      recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: 'object', id: i }, via: 'page' });
    }
    await flushAccessLog();

    expect(insert.mock.calls.filter(([table]) => table === accessEventSchema)).toHaveLength(1);
    expect(await rows()).toHaveLength(25);
  });

  it('folds the same reader viewing the same record from the same client inside a minute into one row', async () => {
    const at = new Date('2026-10-07T12:00:00Z');
    const view = (offsetMs: number, via = 'page') => recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: 'artifact', id: 3 }, via, at: new Date(at.getTime() + offsetMs) });
    view(0);
    view(5_000, 'app'); // the page, then its own refetch
    view(30_000);
    view(61_000); // a minute later is a new read
    recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'download', record: { kind: 'artifact', id: 3 }, via: 'api', at });
    const stats = await flushAccessLog();

    expect(stats.coalesced).toBe(2);
    expect((await rows()).map(r => r.action).sort()).toEqual(['download', 'view', 'view']);
  });

  it('never folds a search, an export or a download: a token paging through a list is every page', async () => {
    const at = new Date('2026-10-07T12:00:00Z');
    for (let page = 0; page < 4; page++) {
      noteCallerRead({ orgId: ORG, actorId: 'token:41', source: 'token' }, { action: 'search', record: { kind: 'object' }, via: 'api', detail: { hits: 50, offset: page * 50 } }, headers({ 'x-real-ip': '198.51.100.4' }));
    }
    for (const action of ['export', 'download'] as const) {
      recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action, record: { kind: 'artifact', id: 3 }, via: 'api', at });
      recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action, record: { kind: 'artifact', id: 3 }, via: 'api', at });
    }
    const stats = await flushAccessLog();
    const written = await rows();

    expect(stats.coalesced).toBe(0);
    expect(written.filter(r => r.action === 'search').map(r => r.detail)).toHaveLength(4);
    // The four pages add up to what was handed over.
    expect(written.filter(r => r.action === 'search').reduce((n, r) => n + Number(r.detail?.hits ?? 0), 0)).toBe(200);
    expect(written.filter(r => r.action === 'export')).toHaveLength(2);
    expect(written.filter(r => r.action === 'download')).toHaveLength(2);
  });

  it('keeps two readers of one share link apart: the fingerprint is part of who', async () => {
    const read = (ip: string) => noteLinkRead(ORG, { action: 'view', record: { kind: 'artifact', id: 8 }, via: 'share' }, headers({ 'x-real-ip': ip, 'user-agent': 'Example/1.0' }));
    await read('198.51.100.4');
    await read('198.51.100.4'); // the same reader again: one row
    await read('203.0.113.9'); // somebody else with the same link
    const stats = await flushAccessLog();
    const written = await rows();

    expect(stats.coalesced).toBe(1);
    expect(written).toHaveLength(2);
    expect(new Set(written.map(r => r.ipHash)).size).toBe(2);
  });

  it('keeps the moment of the read, not of the write', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
    recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: 'object', id: 12 }, via: 'page' });
    vi.setSystemTime(new Date('2026-10-07T12:04:00Z'));
    await flushAccessLog();

    expect((await rows())[0]!.at.toISOString()).toBe('2026-10-07T12:00:00.000Z');
  });

  it('refuses a malformed read rather than writing half a row, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    recordAccess({ orgId: '', actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: 'object', id: 1 }, via: 'page' });
    recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'peek' as never, record: { kind: 'object', id: 1 }, via: 'page' });
    recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: ' ' }, via: 'page' });

    expect(accessLogStats().pending).toBe(0);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith('[access-log] event refused as malformed', expect.objectContaining({ action: 'peek' }));
  });

  it('a database that is not answering never fails the read, and loses nothing inside the retry window — a failover', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
    let up = databaseDown();

    // The read itself returns normally.
    expect(() => recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: 'object', id: 9 }, via: 'page' })).not.toThrow();

    // A minute of failover: every flush fails, nothing is dropped.
    for (let s = 0; s < 6; s++) {
      vi.setSystemTime(new Date(Date.parse('2026-10-07T12:00:00Z') + s * 10_000));

      expect(await flushAccessLog()).toMatchObject({ written: 0, dropped: 0, pending: 1 });
    }

    // Back: the kept row lands, still saying when it was read.
    up();

    expect(await flushAccessLog()).toMatchObject({ written: 1, dropped: 0, pending: 0 });
    expect((await rows())[0]!.at.toISOString()).toBe('2026-10-07T12:00:00.000Z');

    // Down for longer than the window: then, and only then, a counted, logged drop.
    up = databaseDown();
    recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: 'object', id: 10 }, via: 'page' });
    await flushAccessLog();
    vi.setSystemTime(new Date(Date.now() + KEEP_FAILED_MS + 1));
    const stats = await flushAccessLog();
    up();

    expect(stats).toMatchObject({ dropped: 1, pending: 0 });
    // Never silent: every failed write is an error line, and the drop says how many.
    expect(error).toHaveBeenCalledWith('[access-log] database not answering; will retry', expect.objectContaining({ retrying: 1, dropped: 0 }));
    expect(error).toHaveBeenCalledWith('[access-log] database not answering; reads dropped after the retry window', expect.objectContaining({ dropped: 1 }));
  });

  it('cleans what a reader sends: a NUL or a lone surrogate never reaches the database, and nothing grows unbounded', async () => {
    recordAccess({
      orgId: ORG,
      actor: { kind: 'token', tokenId: 'token:41' },
      action: 'download',
      record: { kind: 'file', id: `s3://northwind-docs/\u0000a\uD800b${'x'.repeat(2_000)}` },
      via: `api\u0000${'v'.repeat(500)}`,
      detail: { format: 'pdf\u0000\uDC00', hits: Number.NaN, note: 'y'.repeat(1_000) },
    });
    const stats = await flushAccessLog();
    const [row] = await rows();

    expect(stats).toMatchObject({ written: 1, dropped: 0 });
    expect(row!.recordId!.startsWith('s3://northwind-docs/ab')).toBe(true);
    expect(row!.recordId).toHaveLength(512);
    expect(row!.via).toHaveLength(128);
    expect(row!.detail).toEqual({ format: 'pdf', note: 'y'.repeat(256) });
  });

  it('one row the database refuses costs only that row: the rest of the batch, every workspace\'s, still lands', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    // A row the database refuses on its own, as Postgres refuses a NUL in
    // text (SQLSTATE 22P05) — whatever the reason, the database answers.
    const realInsert = db.insert.bind(db);
    vi.spyOn(db, 'insert').mockImplementation(((table: typeof accessEventSchema) => {
      const builder = realInsert(table);
      const values = builder.values.bind(builder);
      (builder as { values: unknown }).values = (v: Array<{ recordId?: string | null }> | { recordId?: string | null }) => {
        if ((Array.isArray(v) ? v : [v]).some(r => r.recordId === 'refused')) {
          throw Object.assign(new Error('unsupported Unicode escape sequence'), { code: '22P05' });
        }
        return values(v as never);
      };
      return builder;
    }) as never);

    recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: 'object', id: 1 }, via: 'page' });
    recordAccess({ orgId: OTHER, actor: { kind: 'user', userId: 'usr-rowan' }, action: 'view', record: { kind: 'object', id: 2 }, via: 'page' });
    recordAccess({ orgId: OTHER, actor: { kind: 'token', tokenId: 'token:9' }, action: 'download', record: { kind: 'file', id: 'refused' }, via: 'api' });
    recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: 'object', id: 3 }, via: 'page' });
    const stats = await flushAccessLog();

    expect(stats).toMatchObject({ written: 3, dropped: 1, pending: 0 });
    expect((await rows()).map(r => r.recordId).sort()).toEqual(['1', '3']);
    expect((await rows(OTHER)).map(r => r.recordId)).toEqual(['2']);
    expect(error).toHaveBeenCalledWith(
      '[access-log] the database refused reads on their own; dropped, the rest of the batch written',
      expect.objectContaining({ dropped: 1, batch: 4, refused: [expect.objectContaining({ via: 'api', recordKind: 'file' })] }),
    );
  });

  it('writes the owning account once per workspace, and leaves it null for a workspace it cannot find', async () => {
    recordAccess({ orgId: OTHER, actor: { kind: 'link' }, action: 'view', record: { kind: 'artifact', id: 1 }, via: 'share' });
    await flushAccessLog();

    expect((await rows(OTHER))[0]).toMatchObject({ accountId: null, actorKind: 'link', actorId: null });
  });
});

describe('scopes — the reader for code that only knows what it read', () => {
  it('records nothing outside a scope: a system read is nobody looking', async () => {
    expect(noteRead({ action: 'view', record: { kind: 'object', id: 1 } })).toBe(false);
    expect(accessLogStats().pending).toBe(0);
  });

  it('records a note as the scope\'s reader, across awaits', async () => {
    await withAccessScope({ orgId: ORG, actor: { kind: 'token', tokenId: 'token:41' }, via: 'mcp:objects_get' }, async () => {
      await new Promise(resolve => setTimeout(resolve, 1));

      expect(noteRead({ action: 'view', record: { kind: 'object', id: 77 } })).toBe(true);
    });
    await flushAccessLog();

    expect((await rows())[0]).toMatchObject({ actorKind: 'token', actorId: 'token:41', via: 'mcp:objects_get', recordId: '77' });
  });

  it('keeps two concurrent scopes apart', async () => {
    await Promise.all([
      withAccessScope({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, via: 'a' }, async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        noteRead({ action: 'view', record: { kind: 'object', id: 1 } });
      }),
      withAccessScope({ orgId: OTHER, actor: { kind: 'user', userId: 'usr-rowan' }, via: 'b' }, async () => {
        noteRead({ action: 'view', record: { kind: 'object', id: 2 } });
      }),
    ]);
    await flushAccessLog();

    expect((await rows()).map(r => [r.actorId, r.recordId])).toEqual([['usr-dana', '1']]);
    expect((await rows(OTHER)).map(r => [r.actorId, r.recordId])).toEqual([['usr-rowan', '2']]);
  });
});

describe('people, callers and links', () => {
  it('a person\'s read carries keyed hashes of the address and agent, never the values', async () => {
    await notePersonRead(
      { orgId: ORG, userId: 'usr-dana', accountId: ACCOUNT },
      { action: 'view', record: { kind: 'document', id: 4 }, via: 'page' },
      headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'Mozilla/5.0 (Example)' }),
    );
    await flushAccessLog();
    const [row] = await rows();

    expect(row!.ipHash).toMatch(/^[0-9a-f]{32}$/);
    expect(row!.uaHash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(row)).not.toContain('203.0.113.7');
    expect(JSON.stringify(row)).not.toContain('Mozilla');
  });

  it('records nothing for a session with no person', async () => {
    await notePersonRead({ orgId: ORG, userId: null }, { action: 'view', record: { kind: 'object', id: 4 }, via: 'page' }, headers({}));

    expect(accessLogStats().pending).toBe(0);
  });

  it('a token caller is the token, a session caller is the person', async () => {
    noteCallerRead({ orgId: ORG, actorId: 'token:12', source: 'token' }, { action: 'export', record: { kind: 'object', id: 5 }, via: 'api' }, headers({}));
    noteCallerRead({ orgId: ORG, actorId: 'usr-dana', source: 'session' }, { action: 'download', record: { kind: 'artifact', id: 6 }, via: 'api' }, headers({}));
    await flushAccessLog();

    expect((await rows()).map(r => [r.actorKind, r.actorId, r.action]).sort()).toEqual([
      ['token', 'token:12', 'export'],
      ['user', 'usr-dana', 'download'],
    ]);
  });

  it('a share-link read has no actor id, only the fingerprint', async () => {
    await noteLinkRead(ORG, { action: 'view', record: { kind: 'artifact', id: 8 }, via: 'share' }, headers({ 'x-real-ip': '198.51.100.4' }));
    await flushAccessLog();

    expect((await rows())[0]).toMatchObject({ actorKind: 'link', actorId: null, ipHash: expect.stringMatching(/^[0-9a-f]{32}$/) });
  });
});

describe('the table', () => {
  it('is append-only: an update is refused', async () => {
    recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: 'object', id: 1 }, via: 'page' });
    await flushAccessLog();

    const refused = await db.update(accessEventSchema).set({ recordId: '2' }).where(eq(accessEventSchema.orgId, ORG)).then(() => null, (error: Error & { cause?: Error }) => error);

    expect(String(refused?.cause?.message ?? refused?.message)).toMatch(/append-only/);
    expect((await rows())[0]!.recordId).toBe('1');
  });

  it('refuses an action or actor outside the vocabulary at the database too', async () => {
    await expect(db.insert(accessEventSchema).values({ orgId: ORG, actorKind: 'user', actorId: 'usr-dana', action: 'peek', recordKind: 'object', via: 'page' })).rejects.toThrow();
    await expect(db.insert(accessEventSchema).values({ orgId: ORG, actorKind: 'robot', actorId: 'x', action: 'view', recordKind: 'object', via: 'page' })).rejects.toThrow();
  });

  it('keys on (id, at), so it can become range-partitioned by time without new keys', async () => {
    const result = await db.execute(sql`
      SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'access_event'::regclass AND i.indisprimary
    `);
    const columns = ((result as unknown as { rows: Array<{ attname: string }> }).rows).map(r => r.attname).sort();

    expect(columns).toEqual(['at', 'id']);
  });
});

describe('on the way out', () => {
  function hooks() {
    const registered = new Map<string, () => void>();
    vi.spyOn(process, 'once').mockImplementation(((event: string, fn: () => void) => {
      registered.set(event, fn);
      return process;
    }) as never);
    return registered;
  }

  it('flushes what is buffered when a script simply finishes (beforeExit)', async () => {
    const registered = hooks();
    resetAccessLogForTests({ autoFlush: true, hooks: true });
    recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: 'object', id: 1 }, via: 'page' });

    expect([...registered.keys()].sort()).toEqual(['SIGTERM', 'beforeExit', 'exit']);

    registered.get('beforeExit')!();
    await vi.waitFor(async () => expect(await rows()).toHaveLength(1));
  });

  it('flushes on SIGTERM, then lets the process stop when nothing else was listening', async () => {
    const registered = hooks();
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    vi.spyOn(process, 'listenerCount').mockReturnValue(0);
    resetAccessLogForTests({ autoFlush: true, hooks: true });
    recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: 'object', id: 1 }, via: 'page' });

    registered.get('SIGTERM')!();
    await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM'));

    expect(await rows()).toHaveLength(1);
  });

  it('says how many reads a process left unwritten when it exits', () => {
    const registered = hooks();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    resetAccessLogForTests({ autoFlush: true, hooks: true });
    recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: 'object', id: 1 }, via: 'page' });
    registered.get('exit')!();

    expect(error).toHaveBeenCalledWith('[access-log] process exiting with reads unwritten', { pending: 1 });
  });
});
