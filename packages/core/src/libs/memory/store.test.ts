/**
 * The BaseStore protocol over the `memory` table. Worth pinning: the batch
 * operation discrimination (StoreBackend calls through `get`/`put`/`search`),
 * upsert-in-place, delete-by-null, stable search pagination, expiry
 * invisibility, and above all tenancy — a store built for one org must never
 * see another org's rows, whatever the namespace says.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { memorySchema } = await import('@/models/Schema');
const { DrizzleMemoryStore, MEMORY_STORE_NAMESPACE } = await import('@/libs/memory/store');

const ORG = 'org_store_a';
const OTHER_ORG = 'org_store_b';
const NS = MEMORY_STORE_NAMESPACE;

const fileValue = (content: string) => ({
  content,
  mimeType: 'text/markdown',
  created_at: new Date().toISOString(),
  modified_at: new Date().toISOString(),
});

beforeEach(async () => {
  await db.delete(memorySchema);
});

describe('DrizzleMemoryStore', () => {
  it('puts, gets, updates in place, and deletes via null', async () => {
    const store = new DrizzleMemoryStore(ORG);
    await store.put(NS, '/memories/workspace/global/r1.md', fileValue('Never invent numbers.'));

    const item = await store.get(NS, '/memories/workspace/global/r1.md');

    expect(item?.value.content).toBe('Never invent numbers.');
    expect(item?.namespace).toEqual(NS);

    await store.put(NS, '/memories/workspace/global/r1.md', fileValue('Always cite sources.'));

    expect((await db.select().from(memorySchema))).toHaveLength(1);
    expect((await store.get(NS, '/memories/workspace/global/r1.md'))?.value.content).toBe('Always cite sources.');

    await store.delete(NS, '/memories/workspace/global/r1.md');

    expect(await store.get(NS, '/memories/workspace/global/r1.md')).toBeNull();
  });

  it('searches by namespace prefix with stable offset pagination', async () => {
    const store = new DrizzleMemoryStore(ORG);
    for (const k of ['a', 'b', 'c', 'd', 'e']) {
      await store.put(NS, `/memories/workspace/global/${k}.md`, fileValue(k));
    }

    const page1 = await store.search(NS, { limit: 2 });
    const page2 = await store.search(NS, { limit: 2, offset: 2 });
    const page3 = await store.search(NS, { limit: 2, offset: 4 });
    const keys = [...page1, ...page2, ...page3].map(i => i.key);

    expect(keys).toEqual(['a', 'b', 'c', 'd', 'e'].map(k => `/memories/workspace/global/${k}.md`));
  });

  it('filters on value fields', async () => {
    const store = new DrizzleMemoryStore(ORG);
    await store.put(NS, '/memories/x.md', { ...fileValue('x'), kind: 'rule' });
    await store.put(NS, '/memories/y.md', { ...fileValue('y'), kind: 'episode' });

    const rules = await store.search(NS, { filter: { kind: 'rule' } });

    expect(rules.map(r => r.key)).toEqual(['/memories/x.md']);
  });

  it('never sees another org, even under the same namespace and key', async () => {
    const mine = new DrizzleMemoryStore(ORG);
    const theirs = new DrizzleMemoryStore(OTHER_ORG);
    await mine.put(NS, '/memories/workspace/global/r1.md', fileValue('mine'));
    await theirs.put(NS, '/memories/workspace/global/r1.md', fileValue('theirs'));

    expect((await mine.get(NS, '/memories/workspace/global/r1.md'))?.value.content).toBe('mine');
    expect((await theirs.get(NS, '/memories/workspace/global/r1.md'))?.value.content).toBe('theirs');
    expect(await mine.search([], { limit: 100 })).toHaveLength(1);
  });

  it('hides expired rows from every read', async () => {
    const store = new DrizzleMemoryStore(ORG);
    await store.put(NS, '/memories/runs/w/1/episodes/e1.md', fileValue('stale episode'));
    await db.update(memorySchema).set({ expiresAt: new Date(Date.now() - 1000) });

    expect(await store.get(NS, '/memories/runs/w/1/episodes/e1.md')).toBeNull();
    expect(await store.search(NS, { limit: 10 })).toHaveLength(0);
    expect(await store.listNamespaces()).toHaveLength(0);
  });

  it('refuses construction without an org', () => {
    expect(() => new DrizzleMemoryStore('')).toThrow(/tenant-scoped/);
  });
});
