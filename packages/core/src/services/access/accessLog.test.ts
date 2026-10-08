/**
 * The access log's writer: what a read becomes as a row, that a read never
 * waits on or fails with its row, that nothing is dropped without saying so,
 * and that the table is append-only.
 */
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accessEventSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const {
  accessLogStats,
  flushAccessLog,
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
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

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

  it('folds the same reader reading the same record the same way inside a minute into one row', async () => {
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

  it('refuses a malformed read rather than writing half a row, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    recordAccess({ orgId: '', actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: 'object', id: 1 }, via: 'page' });
    recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'peek' as never, record: { kind: 'object', id: 1 }, via: 'page' });
    recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: ' ' }, via: 'page' });

    expect(accessLogStats().pending).toBe(0);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith('[access-log] event refused as malformed', expect.objectContaining({ action: 'peek' }));
  });

  it('a failed write never fails the read, is retried, and is dropped only after its last try — with an error line', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const insert = vi.spyOn(db, 'insert').mockImplementation(() => {
      throw new Error('database unreachable');
    });

    // The read itself returns normally.
    expect(() => recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: 'object', id: 9 }, via: 'page' })).not.toThrow();

    let stats = await flushAccessLog();

    expect(stats).toMatchObject({ written: 0, dropped: 0, pending: 1 });

    // Healthy again: the retried row lands.
    insert.mockRestore();
    stats = await flushAccessLog();

    expect(stats).toMatchObject({ written: 1, dropped: 0, pending: 0 });
    expect(await rows()).toHaveLength(1);

    // Down for good: three tries, then a counted, logged drop.
    const down = vi.spyOn(db, 'insert').mockImplementation(() => {
      throw new Error('database unreachable');
    });
    recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: 'object', id: 10 }, via: 'page' });
    await flushAccessLog();
    await flushAccessLog();
    stats = await flushAccessLog();

    expect(stats).toMatchObject({ dropped: 1, pending: 0 });

    down.mockRestore();

    // Never silent: every failed write is an error line, and the drop says how many.
    expect(error).toHaveBeenCalledWith('[access-log] write failed; will retry', expect.objectContaining({ retrying: 1, dropped: 0 }));
    expect(error).toHaveBeenCalledWith('[access-log] write failed; reads dropped after their last retry', expect.objectContaining({ dropped: 1 }));
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
