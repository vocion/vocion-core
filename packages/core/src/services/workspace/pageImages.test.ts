import type { PageField, PageRow } from '@/libs/workspace/pageFields';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The join between a record that names an artifact and a page that has to
 * draw one. The record stays canonical; only the page's copy is rewritten.
 */

const listArtifactsByIds = vi.fn();
vi.mock('@/services/ArtifactService', () => ({ listArtifactsByIds: (...args: unknown[]) => listArtifactsByIds(...args) }));

const { resolveRowImages } = await import('./pageImages');

function field(over: Partial<PageField> & Pick<PageField, 'key'>): PageField {
  return { label: over.key, format: 'text', total: false, priority: 1, hideWhenConstant: false, detail: false, hideWhenEmpty: true, ...over };
}

function row(id: number, meta: Record<string, unknown>): PageRow {
  return { id, title: `row ${id}`, status: null, createdAt: null, meta };
}

const SHOT = field({ key: 'shot', format: 'image', from: 'meta.shot' });

beforeEach(() => {
  listArtifactsByIds.mockReset();
  listArtifactsByIds.mockResolvedValue([]);
});

describe('resolving a picture a row names by id', () => {
  it('asks once for the whole page, not once per row', async () => {
    listArtifactsByIds.mockResolvedValue([
      { id: 11, url: '/api/artifacts/o-a/o-a.svg', spec: {} },
      { id: 12, url: '/api/artifacts/o-b/o-b.svg', spec: {} },
    ]);
    const rows = [row(1, { shot: 11 }), row(2, { shot: 12 }), row(3, { shot: 11 })];
    const out = await resolveRowImages('org', rows, [SHOT]);

    expect(listArtifactsByIds).toHaveBeenCalledTimes(1);
    expect(listArtifactsByIds.mock.calls[0]![0].ids.sort()).toEqual([11, 12]);
    expect(out.map(r => r.meta.shot)).toEqual(['/api/artifacts/o-a/o-a.svg', '/api/artifacts/o-b/o-b.svg', '/api/artifacts/o-a/o-a.svg']);
  });

  it('reads the url off the file spec when the row does not carry one', async () => {
    listArtifactsByIds.mockResolvedValue([{ id: 11, url: null, spec: { url: '/api/artifacts/o-a/o-a.svg' } }]);
    const [out] = await resolveRowImages('org', [row(1, { shot: 11 })], [SHOT]);

    expect(out!.meta.shot).toBe('/api/artifacts/o-a/o-a.svg');
  });

  it('rewrites a legacy artifact url to the authenticated route', async () => {
    listArtifactsByIds.mockResolvedValue([{ id: 11, url: '/artifacts/o-a.svg', spec: {} }]);
    const [out] = await resolveRowImages('org', [row(1, { shot: 11 })], [SHOT]);

    expect(out!.meta.shot).toBe('/api/artifacts/o-a/o-a.svg');
  });

  it('takes the first of a list, because a card draws one picture', async () => {
    listArtifactsByIds.mockResolvedValue([{ id: 11, url: '/api/artifacts/o-a/o-a.svg', spec: {} }]);
    const [out] = await resolveRowImages('org', [row(1, { shot: [11, 12] })], [SHOT]);

    expect(out!.meta.shot).toBe('/api/artifacts/o-a/o-a.svg');
  });

  it('CLEARS an id that resolves to nothing rather than leaving a broken image', async () => {
    // A row whose artifact was deleted has no picture, and the block draws
    // the empty slot it draws for a row that never had one.
    const [out] = await resolveRowImages('org', [row(1, { shot: 11 })], [SHOT]);

    expect(out!.meta.shot).toBeNull();
  });

  it('leaves a row that already holds a url alone, and asks nothing', async () => {
    const rows = [row(1, { shot: '/api/artifacts/o-a/o-a.svg' })];
    const out = await resolveRowImages('org', rows, [SHOT]);

    expect(listArtifactsByIds).not.toHaveBeenCalled();
    expect(out[0]).toBe(rows[0]);
  });

  it('asks nothing on a page with no image field', async () => {
    await resolveRowImages('org', [row(1, { shot: 11 })], [field({ key: 'shot' })]);

    expect(listArtifactsByIds).not.toHaveBeenCalled();
  });

  it('never writes over a row column', async () => {
    listArtifactsByIds.mockResolvedValue([{ id: 11, url: '/api/artifacts/o-a/o-a.svg', spec: {} }]);
    const rows = [{ ...row(1, {}), title: '11' }];
    const out = await resolveRowImages('org', rows, [field({ key: 'title', format: 'image', from: 'title' })]);

    expect(out[0]!.title).toBe('11');
  });
});
