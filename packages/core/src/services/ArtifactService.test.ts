import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { createConversation } = await import('@/services/ConversationService');
const {
  ArtifactError,
  createArtifact,
  getCanvas,
  listArtifactsForConversation,
  listCanvases,
  saveCanvas,
  setArtifactPinned,
  setArtifactTiles,
  toPayload,
  validateSpec,
} = await import('@/services/ArtifactService');
const { exportCanvasAsPage } = await import('@/libs/canvas/exportPage');

const ORG = 'org_canvas_test';

async function conv() {
  return createConversation({ orgId: ORG, agentSlug: 'revenue-lead', initialTitle: 'Deal desk', createdBy: 'usr-1' });
}

describe('ArtifactService', () => {
  it('validates the spec with the card schema and rejects bad payloads with a readable line', () => {
    expect(() => validateSpec('table', { columns: [], rows: [] })).toThrow(ArtifactError);
    expect(() => validateSpec('nope', {})).toThrow(/unknown artifact kind/);
    expect(validateSpec('markdown', { md: '# hi' }).kind).toBe('markdown');
  });

  it('creates artifacts on successive slots and lists them pinned-first', async () => {
    const c = await conv();
    const a = await createArtifact({ orgId: ORG, conversationId: c.id, kind: 'table', title: 'Open deals', spec: { columns: [{ key: 'name' }], rows: [{ name: 'Acme' }] } });
    const b = await createArtifact({ orgId: ORG, conversationId: c.id, kind: 'record', title: 'Acme', spec: { type: 'Deal', id: '1', label: 'Acme' } });

    expect(a.tile).toEqual({ slot: 0, span: 2 });
    expect(b.tile).toEqual({ slot: 1, span: 1 });

    const rows = await listArtifactsForConversation({ orgId: ORG, conversationId: c.id });

    expect(rows.map(r => r.id)).toEqual([a.id, b.id]);
    expect(toPayload(a)).toMatchObject({ id: a.id, kind: 'table', pinned: true, conversationId: c.id });
  });

  it('honours a requested slot (fill this tile) and hides unpinned rows from the default list', async () => {
    const c = await conv();
    const a = await createArtifact({ orgId: ORG, conversationId: c.id, kind: 'markdown', title: 'Plan', spec: { md: '- one' }, slot: 5, span: 3 });

    expect(a.tile).toEqual({ slot: 5, span: 3 });

    await setArtifactPinned({ orgId: ORG, id: a.id, pinned: false });

    expect(await listArtifactsForConversation({ orgId: ORG, conversationId: c.id })).toHaveLength(0);
    expect(await listArtifactsForConversation({ orgId: ORG, conversationId: c.id, includeUnpinned: true })).toHaveLength(1);
  });

  it('is tenant-scoped', async () => {
    const c = await conv();
    await createArtifact({ orgId: ORG, conversationId: c.id, kind: 'link', title: 'Docs', spec: { href: '/dashboard/docs', title: 'Docs' } });

    expect(await listArtifactsForConversation({ orgId: 'other_org', conversationId: c.id })).toHaveLength(0);
  });

  it('saves a canvas with a copied layout, reopens it in saved order, and exports a page', async () => {
    const c = await conv();
    const t = await createArtifact({ orgId: ORG, conversationId: c.id, kind: 'table', title: 'Open deals', spec: { columns: [{ key: 'name', label: 'Deal' }, { key: 'amount', type: 'currency' }], rows: [{ name: 'Acme', amount: 1200 }] } });
    const m = await createArtifact({ orgId: ORG, conversationId: c.id, kind: 'markdown', title: 'Plan', spec: { md: 'Call Acme.' } });
    const ch = await createArtifact({ orgId: ORG, conversationId: c.id, kind: 'chart', title: 'Trend', spec: { type: 'line', x: ['a'], series: [{ name: 's', values: [1] }] } });
    await setArtifactTiles({ orgId: ORG, tiles: [{ id: m.id, tile: { slot: 0, span: 1 } }, { id: t.id, tile: { slot: 1, span: 2 } }, { id: ch.id, tile: { slot: 2, span: 2 } }] });

    const { canvas } = await saveCanvas({ orgId: ORG, conversationId: c.id, name: 'Deal desk · Monday' });

    expect(canvas.layout.map(l => l.artifactId)).toEqual([t.id, m.id, ch.id]);

    // Moving a tile after saving does not change the saved canvas.
    await setArtifactTiles({ orgId: ORG, tiles: [{ id: m.id, tile: { slot: 9, span: 1 } }] });
    const reopened = await getCanvas({ orgId: ORG, id: canvas.id });

    expect(reopened?.artifacts.map(a => a.id)).toEqual([m.id, t.id, ch.id]);

    const list = await listCanvases({ orgId: ORG });

    expect(list.find(x => x.id === canvas.id)?.tileCount).toBe(3);

    const page = exportCanvasAsPage(reopened!.canvas, reopened!.artifacts);

    expect(page.slug).toBe('deal-desk-monday');
    expect(page.files.map(f => f.path)).toEqual(['pages/deal-desk-monday.yaml', 'pages/deal-desk-monday.md']);
    expect(page.files[0]!.content).toContain('archetype: markdown');
    expect(page.files[1]!.content).toContain('| Deal | amount |');
    expect(page.files[1]!.content).toContain('Call Acme.');
    expect(page.unsupported.map(u => u.kind)).toEqual(['chart']);
  });
});
