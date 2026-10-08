/**
 * Reading the access log back — one workspace at a time, filtered, named —
 * and keeping it to its retention period.
 */
import { eq, inArray } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accessEventSchema, agentSchema, artifactSchema, businessObjectSchema, businessObjectTypeSchema, userSchema } = await import('@/models/Schema');
const { flushAccessLog, recordAccess, resetAccessLogForTests } = await import('./accessLog');
const { accessLogCursorOf, accessLogRetentionDays, listAccessEvents, namesForAccessEvents, parseAccessLogCursor, pruneAccessEvents } = await import('./AccessLogService');

const ORG = 'proj_accesslist_northwind';
const OTHER = 'proj_accesslist_kestrel';
const DAY = 86_400_000;
const NOW = new Date('2026-10-07T12:00:00Z');

function ago(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

async function seed() {
  const reads: Parameters<typeof recordAccess>[0][] = [
    { orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: 'object', id: 1 }, via: 'page', at: ago(1) },
    { orgId: ORG, actor: { kind: 'user', userId: 'usr-rowan' }, action: 'view', record: { kind: 'object', id: 1 }, via: 'preview', at: ago(2) },
    { orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'download', record: { kind: 'artifact', id: 7 }, via: 'api', at: ago(3) },
    { orgId: ORG, actor: { kind: 'agent', agentSlug: 'revenue-lead', onBehalfOf: 'usr-dana', run: { kind: 'conversation', id: 42 } }, action: 'view', record: { kind: 'object', id: 2 }, via: 'tool:read_object', at: ago(4) },
    { orgId: ORG, actor: { kind: 'token', tokenId: 'token:9' }, action: 'export', record: { kind: 'object', id: 3 }, via: 'api', at: ago(40) },
    { orgId: ORG, actor: { kind: 'link' }, action: 'view', record: { kind: 'artifact', id: 7 }, via: 'share', at: ago(400) },
    { orgId: OTHER, actor: { kind: 'user', userId: 'usr-dana' }, action: 'view', record: { kind: 'object', id: 1 }, via: 'page', at: ago(1) },
  ];
  for (const r of reads) {
    recordAccess(r);
  }
  const stats = await flushAccessLog();

  expect(stats).toMatchObject({ written: reads.length, dropped: 0, pending: 0 });
}

beforeEach(async () => {
  resetAccessLogForTests();
  await db.delete(accessEventSchema);
  await seed();
});

describe('listAccessEvents', () => {
  it('reads one workspace only, newest first', async () => {
    const { events, hasMore } = await listAccessEvents(ORG);

    expect(events).toHaveLength(6);
    expect(hasMore).toBe(false);
    expect(events.every(e => e.orgId === ORG)).toBe(true);
    expect(events.map(e => e.at.getTime())).toEqual([...events.map(e => e.at.getTime())].sort((a, b) => b - a));
  });

  it('answers "who read this record"', async () => {
    const { events } = await listAccessEvents(ORG, { recordKind: 'object', recordId: '1' });

    expect(events.map(e => e.actorId)).toEqual(['usr-dana', 'usr-rowan']);
  });

  it('answers "what did this person read" — including what an agent read for them', async () => {
    const { events } = await listAccessEvents(ORG, { actorId: 'usr-dana' });

    expect(events.map(e => [e.actorKind, e.recordKind, e.recordId])).toEqual([
      ['user', 'object', '1'],
      ['user', 'artifact', '7'],
      ['agent', 'object', '2'],
    ]);
  });

  it('filters by action, by kind of reader and by when', async () => {
    expect((await listAccessEvents(ORG, { action: 'download' })).events.map(e => e.recordId)).toEqual(['7']);
    expect((await listAccessEvents(ORG, { actorKind: 'agent' })).events.map(e => e.runId)).toEqual(['42']);
    expect((await listAccessEvents(ORG, { since: ago(30) })).events).toHaveLength(4);
    expect((await listAccessEvents(ORG, { until: ago(30) })).events.map(e => e.actorKind)).toEqual(['token', 'link']);
  });

  it('pages by keyset: each page starts strictly after the last row of the one before, and says when it is the last', async () => {
    const first = await listAccessEvents(ORG, { limit: 4 });

    expect(first).toMatchObject({ hasMore: true });
    expect(first.events).toHaveLength(4);
    expect(first.next).toBe(accessLogCursorOf(first.events[3]!));

    const second = await listAccessEvents(ORG, { limit: 4, before: parseAccessLogCursor(first.next)! });

    expect(second).toMatchObject({ hasMore: false, next: null });
    expect(second.events).toHaveLength(2);
    // Every row once, in order, across the pages.
    expect([...first.events, ...second.events].map(e => e.id)).toEqual((await listAccessEvents(ORG)).events.map(e => e.id));
  });

  it('breaks a tie on the moment by id, so reads in the same millisecond are neither repeated nor skipped', async () => {
    await db.delete(accessEventSchema);
    const at = ago(1);
    for (let id = 1; id <= 5; id++) {
      recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-dana' }, action: 'search', record: { kind: 'object' }, via: 'api', at });
    }
    await flushAccessLog();
    const seen: number[] = [];
    let before: ReturnType<typeof parseAccessLogCursor> | undefined;
    for (let page = 0; page < 5; page++) {
      const p = await listAccessEvents(ORG, { limit: 2, before: before ?? undefined });
      seen.push(...p.events.map(e => e.id));
      if (!p.next) {
        break;
      }
      before = parseAccessLogCursor(p.next);
    }

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it('reads a cursor back, and refuses anything that is not one', () => {
    const at = new Date('2026-10-07T12:00:00.123Z');

    expect(parseAccessLogCursor(accessLogCursorOf({ at, id: 42 }))).toEqual({ at, id: 42 });
    expect(parseAccessLogCursor('')).toBeNull();
    expect(parseAccessLogCursor('yesterday,4')).toBeNull();
    expect(parseAccessLogCursor('2026-10-07T12:00:00Z,abc')).toBeNull();
    expect(parseAccessLogCursor('2026-10-07T12:00:00Z,4,5')).toBeNull();
  });
});

describe('namesForAccessEvents', () => {
  it('names people, agents and records from this workspace only', async () => {
    await db.delete(userSchema).where(inArray(userSchema.id, ['usr-dana', 'usr-rowan']));
    await db.insert(userSchema).values([
      { id: 'usr-dana', name: 'Dana Whitfield', email: 'dana@northwind.example' },
      { id: 'usr-rowan', name: null, email: 'rowan@northwind.example' },
    ]);
    await db.delete(agentSchema).where(eq(agentSchema.orgId, ORG));
    await db.insert(agentSchema).values({ orgId: ORG, slug: 'revenue-lead', name: 'Revenue Lead', systemPrompt: 'x' });
    const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'account', label: 'Account' }).returning();
    const [obj] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: type!.id, title: 'Northwind renewal' }).returning();
    const [art] = await db.insert(artifactSchema).values({ orgId: ORG, kind: 'markdown', title: 'Renewal brief', spec: { md: 'x' } }).returning();
    const [otherObj] = await db.insert(businessObjectSchema).values({ orgId: OTHER, typeId: type!.id, title: 'Kestrel deal' }).returning();

    recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-rowan' }, action: 'view', record: { kind: 'object', id: obj!.id }, via: 'page' });
    recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-rowan' }, action: 'view', record: { kind: 'artifact', id: art!.id }, via: 'page' });
    recordAccess({ orgId: ORG, actor: { kind: 'user', userId: 'usr-rowan' }, action: 'view', record: { kind: 'object', id: otherObj!.id }, via: 'page' });
    await flushAccessLog();

    const { events } = await listAccessEvents(ORG);
    const names = await namesForAccessEvents(ORG, events);

    expect(names.actors).toMatchObject({ 'usr-dana': 'Dana Whitfield', 'usr-rowan': 'rowan@northwind.example', 'revenue-lead': 'Revenue Lead' });
    expect(names.records[`object:${obj!.id}`]).toBe('Northwind renewal');
    expect(names.records[`artifact:${art!.id}`]).toBe('Renewal brief');
    // Another workspace's record is not named through this one.
    expect(names.records[`object:${otherObj!.id}`]).toBeUndefined();
  });
});

describe('retention', () => {
  it('keeps a year by default, nothing pruned at 0, and a bad value is the default, not off', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(accessLogRetentionDays(undefined)).toBe(365);
    expect(accessLogRetentionDays('')).toBe(365);
    expect(accessLogRetentionDays('90')).toBe(90);
    expect(accessLogRetentionDays('0')).toBeNull();
    expect(accessLogRetentionDays('ninety')).toBe(365);
    // A number no date can hold is a typo too: the default, never an Invalid Date at prune time.
    expect(accessLogRetentionDays('99999999999')).toBe(365);
    expect(accessLogRetentionDays('36500')).toBe(36_500);
    expect(warn).toHaveBeenCalledTimes(2);

    warn.mockRestore();
  });

  it('prunes only what is older than the period, across workspaces', async () => {
    const result = await pruneAccessEvents(NOW, 365);

    expect(result).toMatchObject({ deleted: 1, moreRemaining: false, cutoff: ago(365).toISOString() });
    expect((await listAccessEvents(ORG)).events.map(e => e.actorKind)).not.toContain('link');

    expect(await pruneAccessEvents(NOW, 30)).toMatchObject({ deleted: 1 });
    expect((await listAccessEvents(ORG)).events).toHaveLength(4);
    expect((await listAccessEvents(OTHER)).events).toHaveLength(1);
  });

  it('never builds a date it cannot represent, whatever it is handed', async () => {
    await expect(pruneAccessEvents(NOW, 99_999_999_999)).resolves.toMatchObject({ deleted: 0 });
  });

  it('does nothing when retention is off', async () => {
    expect(await pruneAccessEvents(NOW, null)).toBeNull();
    expect((await listAccessEvents(ORG)).events).toHaveLength(6);
  });
});
