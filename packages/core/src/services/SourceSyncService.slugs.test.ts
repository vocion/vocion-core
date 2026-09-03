/**
 * Creating source rows: one at a time, and many from an import.
 *
 * The behaviour under test is the fix for a silent data loss. `addSource` used
 * to hand back the existing row whenever the generated slug collided, so adding
 * a second page from a host you already had returned "success" and stored
 * nothing. Two pages on one host must be two sources, and a genuine collision
 * must be an error the caller can show.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema } = await import('@/models/Schema');
const { addSource, addSourcesFromImport, SourceSlugTakenError } = await import('@/services/SourceSyncService');

const ORG = 'org_slugs';

/** Every source this org holds, slug plus config, ordered by id. */
async function storedSources() {
  const rows = await db
    .select({
      slug: knowledgeSourceSchema.slug,
      configJson: knowledgeSourceSchema.configJson,
    })
    .from(knowledgeSourceSchema)
    .orderBy(knowledgeSourceSchema.id);
  return rows;
}

beforeEach(async () => {
  await db.delete(knowledgeSourceSchema);
});

afterAll(async () => {
  await db.delete(knowledgeSourceSchema);
});

describe('addSource', () => {
  it('names a web source after its host and path', async () => {
    const created = await addSource({
      orgId: ORG,
      kind: 'web',
      configJson: { crawl: { startUrl: 'https://docs.example.com/guide/intro' } },
    });

    expect(created.slug).toBe('web-docs-example-com-guide-intro');
  });

  it('keeps two pages on one host as two sources', async () => {
    const first = await addSource({
      orgId: ORG,
      kind: 'web',
      configJson: { urls: ['https://docs.example.com/a'] },
    });
    const second = await addSource({
      orgId: ORG,
      kind: 'web',
      configJson: { urls: ['https://docs.example.com/b'] },
    });

    expect(first.slug).not.toBe(second.slug);
    expect(await storedSources()).toHaveLength(2);
  });

  it('suffixes rather than overwriting when the derived slug is taken', async () => {
    // Two paths that slugify identically, so both want the same name.
    await addSource({ orgId: ORG, kind: 'web', configJson: { urls: ['https://a.example/one_two'] } });
    const second = await addSource({ orgId: ORG, kind: 'web', configJson: { urls: ['https://a.example/one-two'] } });

    expect(second.slug).toBe('web-a-example-one-two-2');

    const stored = await storedSources();

    expect(stored).toHaveLength(2);
    expect(stored[0]!.configJson).toMatchObject({ urls: ['https://a.example/one_two'] });
    expect(stored[1]!.configJson).toMatchObject({ urls: ['https://a.example/one-two'] });
  });

  it('refuses an explicit slug that is already taken instead of returning the old row', async () => {
    await addSource({
      orgId: ORG,
      kind: 'web',
      slug: 'product-docs',
      configJson: { urls: ['https://a.example/first'] },
    });

    await expect(addSource({
      orgId: ORG,
      kind: 'web',
      slug: 'product-docs',
      configJson: { urls: ['https://a.example/second'] },
    })).rejects.toThrow(SourceSlugTakenError);

    const stored = await storedSources();

    expect(stored).toHaveLength(1);
    expect(stored[0]!.configJson).toMatchObject({ urls: ['https://a.example/first'] });
  });

  it('records which connector created the row', async () => {
    await addSource({ orgId: ORG, kind: 'slack', configJson: { channel: 'C0123ABCD' } });

    expect((await storedSources())[0]!.configJson).toMatchObject({ _connector: 'slack', channel: 'C0123ABCD' });
  });

  it('names a source with no identity in its config after the clock, not a collision', async () => {
    // `granola` has no bulk-import descriptor, so nothing in its config names it.
    const first = await addSource({ orgId: ORG, kind: 'granola', configJson: {} });

    expect(first.slug).toMatch(/^granola-\d+$/);
  });

  it('refuses an unknown connector', async () => {
    await expect(addSource({ orgId: ORG, kind: 'nope', configJson: {} })).rejects.toThrow(/Unknown source connector/);
  });

  it('refuses a config its connector rejects', async () => {
    await expect(addSource({ orgId: ORG, kind: 'web', configJson: {} })).rejects.toThrow();
    expect(await storedSources()).toHaveLength(0);
  });
});

describe('addSourcesFromImport', () => {
  it('creates every row in one pass', async () => {
    const created = await addSourcesFromImport({
      orgId: ORG,
      kind: 'web',
      rows: [
        { slug: 'web-a', configJson: { urls: ['https://a.example/1'] } },
        { slug: 'web-b', configJson: { urls: ['https://a.example/2'] } },
        { slug: 'web-c', configJson: { urls: ['https://a.example/3'] } },
      ],
    });

    expect(created.map(row => row.slug)).toEqual(['web-a', 'web-b', 'web-c']);
    expect(await storedSources()).toHaveLength(3);
  });

  it('creates nothing when one row collides with an existing source', async () => {
    await addSource({ orgId: ORG, kind: 'web', slug: 'web-taken', configJson: { urls: ['https://a.example/x'] } });

    await expect(addSourcesFromImport({
      orgId: ORG,
      kind: 'web',
      rows: [
        { slug: 'web-new', configJson: { urls: ['https://a.example/1'] } },
        { slug: 'web-taken', configJson: { urls: ['https://a.example/2'] } },
      ],
    })).rejects.toThrow(SourceSlugTakenError);

    // A half-applied import is worse than none: the operator could not tell
    // which rows to remove before retrying.
    expect((await storedSources()).map(row => row.slug)).toEqual(['web-taken']);
  });

  it('creates nothing when two rows in the batch claim one slug', async () => {
    await expect(addSourcesFromImport({
      orgId: ORG,
      kind: 'web',
      rows: [
        { slug: 'web-same', configJson: { urls: ['https://a.example/1'] } },
        { slug: 'web-same', configJson: { urls: ['https://a.example/2'] } },
      ],
    })).rejects.toThrow(SourceSlugTakenError);

    expect(await storedSources()).toHaveLength(0);
  });

  it('creates nothing when one row fails its connector schema', async () => {
    await expect(addSourcesFromImport({
      orgId: ORG,
      kind: 'web',
      rows: [
        { slug: 'web-good', configJson: { urls: ['https://a.example/1'] } },
        { slug: 'web-bad', configJson: {} },
      ],
    })).rejects.toThrow();

    expect(await storedSources()).toHaveLength(0);
  });

  it('refuses an unknown connector', async () => {
    await expect(addSourcesFromImport({ orgId: ORG, kind: 'nope', rows: [] }))
      .rejects
      .toThrow(/Unknown source connector/);
  });

  it('names the offending slug on the error, so the caller can say which row', async () => {
    await addSource({ orgId: ORG, kind: 'web', slug: 'web-clash', configJson: { urls: ['https://a.example/x'] } });

    await expect(addSourcesFromImport({
      orgId: ORG,
      kind: 'web',
      rows: [{ slug: 'web-clash', configJson: { urls: ['https://a.example/1'] } }],
    })).rejects.toThrow(/"web-clash" already exists/);
  });
});
