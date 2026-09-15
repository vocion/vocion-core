/**
 * Pure tile-placement logic for the canvas grid. No React, no DOM — tested
 * on its own. The grid is a row of `COLUMNS` cells; every artifact has a
 * `slot` (order) and a `span` (1–3 columns). Empty placeholders fill out to
 * `MIN_SLOTS` so there is always somewhere to type "describe what goes here".
 */

import type { ArtifactPayload } from '@/services/agents/types';

export const COLUMNS = 3;
export const MIN_SLOTS = 6;
export type Span = 1 | 2 | 3;

export type PlacedTile
  = | { kind: 'artifact'; slot: number; span: Span; artifact: ArtifactPayload }
    | { kind: 'empty'; slot: number; span: 1 };

export type CanvasState = {
  artifacts: ArtifactPayload[];
  /** Placeholder slots a person is currently typing into (slot → draft text). */
  drafts: Record<number, string>;
};

export type CanvasAction
  = | { type: 'set'; artifacts: ArtifactPayload[] }
    | { type: 'upsert'; artifact: ArtifactPayload }
    | { type: 'remove'; id: number }
    | { type: 'reorder'; fromId: number; toId: number }
    | { type: 'span'; id: number; span: Span }
    | { type: 'draft'; slot: number; text: string }
    | { type: 'clearDraft'; slot: number };

export const initialCanvasState: CanvasState = { artifacts: [], drafts: {} };

function slotOf(a: ArtifactPayload, i: number): number {
  return a.tile?.slot ?? i;
}

/** Artifacts pinned to the canvas, in slot order (ties by id so the order is stable). */
export function visibleArtifacts(state: CanvasState): ArtifactPayload[] {
  return state.artifacts
    .filter(a => a.pinned)
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (slotOf(x.a, x.i) - slotOf(y.a, y.i)) || (x.a.id - y.a.id))
    .map(x => x.a);
}

/**
 * The grid as rendered: artifacts in order, then empty slots up to
 * `MIN_SLOTS` (or one full row past the last artifact, whichever is more),
 * so the "describe what goes here" affordance is always present. Slots are
 * renumbered densely (0..n) on the way out — persisted slots may have gaps.
 * @param state
 */
export function layoutTiles(state: CanvasState): PlacedTile[] {
  const tiles: PlacedTile[] = visibleArtifacts(state).map((a, i) => ({
    kind: 'artifact',
    slot: i,
    span: (a.tile?.span ?? (a.kind === 'table' || a.kind === 'chart' ? 2 : 1)) as Span,
    artifact: a,
  }));
  const used = tiles.reduce((n, t) => n + t.span, 0);
  const wantSlots = Math.max(MIN_SLOTS, tiles.length + COLUMNS);
  let slot = tiles.length;
  // Pad to the next full row after the last artifact, then to the minimum.
  let cells = used;
  while (slot < wantSlots || cells % COLUMNS !== 0) {
    tiles.push({ kind: 'empty', slot, span: 1 });
    slot += 1;
    cells += 1;
    if (slot > 64) {
      break;
    }
  }
  return tiles;
}

/** Placement to persist after a reorder/resize: dense slots in the current visible order. */
export function placementOf(state: CanvasState): Array<{ id: number; tile: { slot: number; span: Span } }> {
  return visibleArtifacts(state).map((a, i) => ({ id: a.id, tile: { slot: i, span: (a.tile?.span ?? (a.kind === 'table' || a.kind === 'chart' ? 2 : 1)) as Span } }));
}

export function canvasReducer(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case 'set':
      return { ...state, artifacts: action.artifacts };
    case 'upsert': {
      const exists = state.artifacts.some(a => a.id === action.artifact.id);
      const artifacts = exists
        ? state.artifacts.map(a => (a.id === action.artifact.id ? action.artifact : a))
        : [...state.artifacts, action.artifact];
      // A tool filled a requested slot: the draft that asked for it is done.
      const slot = action.artifact.tile?.slot;
      const drafts = typeof slot === 'number' && slot in state.drafts ? Object.fromEntries(Object.entries(state.drafts).filter(([k]) => Number(k) !== slot)) : state.drafts;
      return { ...state, artifacts, drafts };
    }
    case 'remove':
      return { ...state, artifacts: state.artifacts.filter(a => a.id !== action.id) };
    case 'reorder': {
      const order = visibleArtifacts(state);
      const from = order.findIndex(a => a.id === action.fromId);
      const to = order.findIndex(a => a.id === action.toId);
      if (from < 0 || to < 0 || from === to) {
        return state;
      }
      const next = [...order];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      const slotById = new Map(next.map((a, i) => [a.id, i]));
      return {
        ...state,
        artifacts: state.artifacts.map(a => (slotById.has(a.id) ? { ...a, tile: { slot: slotById.get(a.id)!, span: (a.tile?.span ?? 1) as Span } } : a)),
      };
    }
    case 'span':
      return { ...state, artifacts: state.artifacts.map(a => (a.id === action.id ? { ...a, tile: { slot: a.tile?.slot ?? 0, span: action.span } } : a)) };
    case 'draft':
      return { ...state, drafts: { ...state.drafts, [action.slot]: action.text } };
    case 'clearDraft': {
      const { [action.slot]: _drop, ...rest } = state.drafts;
      return { ...state, drafts: rest };
    }
    default:
      return state;
  }
}

/** The message a person's empty-tile prompt becomes — the model reads the slot back as `tile_slot`. */
export function fillTileMessage(slot: number, text: string): string {
  return `Fill tile ${slot}: ${text.trim()}`;
}
