'use client';

/**
 * The tile grid beside a conversation. Three columns on md+, one below.
 * Artifact tiles are sortable (dnd-kit, keyboard + pointer); empty tiles take
 * a prompt. Placement changes persist through `artifacts.placeTiles`; hide
 * persists through `setPinned`. All state lives in `canvasReducer`.
 */

import type { CanvasAction, CanvasState, Span } from './canvasReducer';
import type { ArtifactPayload } from '@/services/agents/types';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useCallback, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { client } from '@/libs/Orpc';
import { ArtifactCard } from './ArtifactCard';
import { ArtifactTile } from './ArtifactTile';
import { canvasReducer, fillTileMessage, layoutTiles, placementOf } from './canvasReducer';
import { EmptyTile } from './EmptyTile';

export function CanvasGrid({ state, dispatch, onSend, disabled }: {
  state: CanvasState;
  dispatch: (a: CanvasAction) => void;
  /** Sends a normal chat turn — the "Fill tile N: …" ask. */
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const tiles = layoutTiles(state);
  const artifactIds = tiles.filter(t => t.kind === 'artifact').map(t => (t as { artifact: ArtifactPayload }).artifact.id);
  const hidden = state.artifacts.filter(a => !a.pinned);
  const [expanded, setExpanded] = useState<ArtifactPayload | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const persist = useCallback((next: CanvasState) => {
    const tiles = placementOf(next);
    if (tiles.length > 0) {
      void client.artifacts.placeTiles({ tiles }).catch(err => console.warn('canvas: placement not saved', err));
    }
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={({ active, over }) => {
          if (!over || active.id === over.id) {
            return;
          }
          const action: CanvasAction = { type: 'reorder', fromId: Number(active.id), toId: Number(over.id) };
          dispatch(action);
          // Compute the post-reorder placement locally to persist it.
          persist(reorderPreview(state, action));
        }}
      >
        <SortableContext items={artifactIds} strategy={rectSortingStrategy}>
          <div className="grid auto-rows-min grid-cols-1 gap-3 md:grid-cols-3" data-canvas-grid>
            {tiles.map(tile => (tile.kind === 'artifact'
              ? (
                  <ArtifactTile
                    key={`a-${tile.artifact.id}`}
                    artifact={tile.artifact}
                    span={tile.span}
                    onSpan={(span: Span) => {
                      const action: CanvasAction = { type: 'span', id: tile.artifact.id, span };
                      dispatch(action);
                      persist(spanPreview(state, action));
                    }}
                    onClose={() => {
                      dispatch({ type: 'upsert', artifact: { ...tile.artifact, pinned: false } });
                      void client.artifacts.setPinned({ id: tile.artifact.id, pinned: false }).catch(err => console.warn('canvas: hide not saved', err));
                    }}
                    onExpand={() => setExpanded(tile.artifact)}
                  />
                )
              : (
                  <EmptyTile
                    key={`e-${tile.slot}`}
                    slot={tile.slot}
                    draft={state.drafts[tile.slot] ?? ''}
                    disabled={disabled}
                    onDraft={text => dispatch({ type: 'draft', slot: tile.slot, text })}
                    onClear={() => dispatch({ type: 'clearDraft', slot: tile.slot })}
                    onSubmit={(text) => {
                      onSend(fillTileMessage(tile.slot, text));
                    }}
                  />
                )))}
          </div>
        </SortableContext>
      </DndContext>

      {hidden.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Hidden · {hidden.length}</summary>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {hidden.map(a => (
              <li key={a.id}>
                <button
                  type="button"
                  className="rounded-full border border-border px-2 py-0.5 hover:bg-muted"
                  onClick={() => {
                    dispatch({ type: 'upsert', artifact: { ...a, pinned: true } });
                    void client.artifacts.setPinned({ id: a.id, pinned: true }).catch(err => console.warn('canvas: show not saved', err));
                  }}
                >
                  {a.title}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <Sheet open={expanded !== null} onOpenChange={open => !open && setExpanded(null)}>
        <SheetContent side="right" className="w-full overflow-auto sm:max-w-3xl">
          {expanded && (
            <>
              <SheetHeader>
                <SheetTitle>{expanded.title}</SheetTitle>
              </SheetHeader>
              <div className="mt-4">
                <ArtifactCard artifact={expanded} surface="canvas" />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// Post-action state for persistence, without waiting for a second render.
function reorderPreview(state: CanvasState, action: Extract<CanvasAction, { type: 'reorder' }>): CanvasState {
  return canvasReducer(state, action);
}
function spanPreview(state: CanvasState, action: Extract<CanvasAction, { type: 'span' }>): CanvasState {
  return canvasReducer(state, action);
}
