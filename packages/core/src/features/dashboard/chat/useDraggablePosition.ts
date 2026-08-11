'use client';

import type { RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

export type DragPosition = {
  right: number;
  bottom: number;
};

const DEFAULT_POSITION: DragPosition = { right: 16, bottom: 16 };
const EDGE_MARGIN = 8;
const DRAG_THRESHOLD_PX = 4;

function readPosition(storageKey: string): DragPosition {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<DragPosition>;
      if (typeof parsed.right === 'number' && typeof parsed.bottom === 'number') {
        return { right: parsed.right, bottom: parsed.bottom };
      }
    }
  } catch {
    /* storage unavailable or corrupt — fall back to default corner */
  }
  return DEFAULT_POSITION;
}

function clampToViewport(next: DragPosition, element: HTMLElement | null): DragPosition {
  const width = element?.offsetWidth ?? 0;
  const height = element?.offsetHeight ?? 0;
  const maxRight = Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN);
  const maxBottom = Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN);
  return {
    right: Math.min(Math.max(next.right, EDGE_MARGIN), maxRight),
    bottom: Math.min(Math.max(next.bottom, EDGE_MARGIN), maxBottom),
  };
}

/**
 * Lets the chat bubble button and its panel be dragged to any corner of the
 * viewport instead of staying pinned bottom-right. Position is `{ right,
 * bottom }` px offsets (matching the existing `fixed right-4 bottom-4`
 * layout), persisted to localStorage, and shared across the collapsed
 * button and the open panel — dragging one moves both because they render
 * from the same state.
 *
 * Exposes `consumeDragClick` so a draggable element that's also clickable
 * (the collapsed launcher button) can tell a real click from the click
 * event a browser fires right after a drag's pointerup: check it first
 * thing in the onClick handler and bail out if it returns true.
 * @param storageKey - localStorage key this widget's position is saved under.
 * @param elementRef - ref to whichever element is currently on screen (button or panel), used to clamp against its actual size.
 */
export function useDraggablePosition(storageKey: string, elementRef: RefObject<HTMLElement | null>) {
  const [position, setPosition] = useState<DragPosition>(DEFAULT_POSITION);
  const draggedRef = useRef(false);

  useEffect(() => {
    // One-time read of a client-only value on mount — mirrors the visual
    // state hydration pattern used elsewhere in this widget.
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setPosition(readPosition(storageKey));
  }, [storageKey]);

  const startDrag = useCallback((event: React.PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    const startX = event.clientX;
    const startY = event.clientY;
    const startRight = position.right;
    const startBottom = position.bottom;
    let dragged = false;

    function onMove(moveEvent: PointerEvent) {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      if (!dragged && Math.hypot(deltaX, deltaY) > DRAG_THRESHOLD_PX) {
        dragged = true;
        draggedRef.current = true;
      }
      setPosition(clampToViewport({ right: startRight - deltaX, bottom: startBottom - deltaY }, elementRef.current));
    }

    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (!dragged) {
        return;
      }
      setPosition((current) => {
        try {
          localStorage.setItem(storageKey, JSON.stringify(current));
        } catch {
          /* storage unavailable — position still holds for this session */
        }
        return current;
      });
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [position, storageKey, elementRef]);

  const consumeDragClick = useCallback(() => {
    if (!draggedRef.current) {
      return false;
    }
    draggedRef.current = false;
    return true;
  }, []);

  return { position, startDrag, consumeDragClick };
}
