import type { ArtifactPayload } from '@/services/agents/types';
import { describe, expect, it } from 'vitest';
import { canvasReducer, COLUMNS, fillTileMessage, initialCanvasState, layoutTiles, MIN_SLOTS, placementOf } from './canvasReducer';

function art(id: number, kind: ArtifactPayload['kind'] = 'markdown', tile?: ArtifactPayload['tile'], pinned = true): ArtifactPayload {
  return { id, conversationId: 1, kind, title: `a${id}`, spec: {}, tile: tile ?? null, pinned, createdAt: '2026-09-15T00:00:00Z' };
}

describe('canvasReducer', () => {
  it('pads an empty canvas with placeholder tiles', () => {
    const tiles = layoutTiles(initialCanvasState);
    expect(tiles.length).toBeGreaterThanOrEqual(MIN_SLOTS);
    expect(tiles.every(t => t.kind === 'empty')).toBe(true);
    expect(tiles.reduce((n, t) => n + t.span, 0) % COLUMNS).toBe(0);
  });

  it('places artifacts by slot, tables/charts spanning two columns by default', () => {
    const state = canvasReducer(initialCanvasState, { type: 'set', artifacts: [art(2, 'table', { slot: 1, span: 2 }), art(1, 'record', { slot: 0, span: 1 })] });
    const tiles = layoutTiles(state);
    expect(tiles[0]).toMatchObject({ kind: 'artifact', slot: 0, span: 1 });
    expect(tiles[1]).toMatchObject({ kind: 'artifact', slot: 1, span: 2 });
    expect(tiles.filter(t => t.kind === 'empty').length).toBeGreaterThan(0);
  });

  it('upsert into a requested slot clears the draft that asked for it', () => {
    let state = canvasReducer(initialCanvasState, { type: 'draft', slot: 3, text: 'open deals' });
    expect(state.drafts[3]).toBe('open deals');
    state = canvasReducer(state, { type: 'upsert', artifact: art(9, 'table', { slot: 3, span: 2 }) });
    expect(state.drafts[3]).toBeUndefined();
    expect(state.artifacts.map(a => a.id)).toEqual([9]);
  });

  it('reorder renumbers slots densely and placementOf reports them', () => {
    let state = canvasReducer(initialCanvasState, { type: 'set', artifacts: [art(1, 'markdown', { slot: 0, span: 1 }), art(2, 'markdown', { slot: 1, span: 1 }), art(3, 'markdown', { slot: 2, span: 1 })] });
    state = canvasReducer(state, { type: 'reorder', fromId: 3, toId: 1 });
    expect(placementOf(state).map(p => p.id)).toEqual([3, 1, 2]);
    expect(placementOf(state).map(p => p.tile.slot)).toEqual([0, 1, 2]);
  });

  it('span changes only the target and hidden artifacts leave the grid', () => {
    let state = canvasReducer(initialCanvasState, { type: 'set', artifacts: [art(1, 'chart', { slot: 0, span: 2 }), art(2, 'record', { slot: 1, span: 1 })] });
    state = canvasReducer(state, { type: 'span', id: 1, span: 3 });
    expect(state.artifacts.find(a => a.id === 1)?.tile?.span).toBe(3);
    state = canvasReducer(state, { type: 'upsert', artifact: { ...art(2, 'record', { slot: 1, span: 1 }), pinned: false } });
    expect(layoutTiles(state).filter(t => t.kind === 'artifact').map(t => (t as { artifact: ArtifactPayload }).artifact.id)).toEqual([1]);
  });

  it('formats the fill-tile ask the model reads back as tile_slot', () => {
    expect(fillTileMessage(4, '  open deals by stage ')).toBe('Fill tile 4: open deals by stage');
  });
});
