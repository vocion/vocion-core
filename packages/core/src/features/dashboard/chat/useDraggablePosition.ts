'use client';

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
  } catch (error) {
    console.error('useDraggablePosition: failed to read persisted position', error);
  }
  return DEFAULT_POSITION;
}

function persistPosition(storageKey: string, position: DragPosition) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(position));
  } catch (error) {
    console.error('useDraggablePosition: failed to persist position', error);
  }
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

type DragSession = {
  startClientX: number;
  startClientY: number;
  startPosition: DragPosition;
};

function startDragSession(event: React.PointerEvent, position: DragPosition): DragSession {
  return { startClientX: event.clientX, startClientY: event.clientY, startPosition: position };
}

function hasCrossedDragThreshold(session: DragSession, clientX: number, clientY: number): boolean {
  const deltaX = clientX - session.startClientX;
  const deltaY = clientY - session.startClientY;
  return Math.hypot(deltaX, deltaY) > DRAG_THRESHOLD_PX;
}

function positionForPointer(session: DragSession, clientX: number, clientY: number, element: HTMLElement | null): DragPosition {
  const deltaX = clientX - session.startClientX;
  const deltaY = clientY - session.startClientY;
  return clampToViewport({ right: session.startPosition.right - deltaX, bottom: session.startPosition.bottom - deltaY }, element);
}

function positionsEqual(a: DragPosition, b: DragPosition): boolean {
  return a.right === b.right && a.bottom === b.bottom;
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
 *
 * Consumers attach the returned `dragRef` callback ref to whichever element
 * is currently on screen (button or panel) instead of a plain `useRef`, so
 * this hook notices when that element is swapped for a differently-sized
 * one (button ↔ panel) or resized in place (normal ↔ maximized) and
 * re-clamps the persisted position against the new size — otherwise a
 * position saved against a small button could sit off-screen once the
 * panel opens.
 * @param storageKey - localStorage key this widget's position is saved under.
 */
export function useDraggablePosition(storageKey: string) {
  const [position, setPosition] = useState<DragPosition>(DEFAULT_POSITION);
  const [elementNode, setElementNode] = useState<HTMLElement | null>(null);
  const draggedRef = useRef(false);
  const activeDragAbortRef = useRef<AbortController | null>(null);

  const dragRef = useCallback((node: HTMLElement | null) => {
    setElementNode(node);
  }, []);

  useEffect(() => {
    // Re-runs on mount (hydrating from localStorage) and again whenever the
    // drag handle is swapped for a differently-sized element, clamping
    // against whichever size is current in both cases.
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setPosition(clampToViewport(readPosition(storageKey), elementNode));
  }, [storageKey, elementNode]);

  useEffect(() => {
    // Catches in-place resizes of the same element (normal ↔ maximized
    // toggles a className on one persistent div, so its identity never
    // changes and the effect above never re-fires) — anything the viewport
    // or the element's own size does that the drag/hydrate paths miss.
    if (!elementNode) {
      return;
    }
    const observer = new ResizeObserver(() => {
      setPosition((current) => {
        const clamped = clampToViewport(current, elementNode);
        if (positionsEqual(clamped, current)) {
          return current;
        }
        persistPosition(storageKey, clamped);
        return clamped;
      });
    });
    observer.observe(elementNode);
    return () => observer.disconnect();
  }, [elementNode, storageKey]);

  useEffect(() => {
    // If the widget unmounts mid-drag (route change while dragging), abort
    // the in-flight listeners instead of leaving them attached to
    // `document` forever — see stopDragSession below, which this shares.
    return () => activeDragAbortRef.current?.abort();
  }, []);

  const startDrag = useCallback((event: React.PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    const session = startDragSession(event, position);
    const abortController = new AbortController();
    activeDragAbortRef.current = abortController;

    function stopDragSession(dragged: boolean) {
      abortController.abort();
      activeDragAbortRef.current = null;
      if (!dragged) {
        return;
      }
      setPosition((current) => {
        persistPosition(storageKey, current);
        return current;
      });
    }

    document.addEventListener('pointermove', (moveEvent) => {
      if (!draggedRef.current && hasCrossedDragThreshold(session, moveEvent.clientX, moveEvent.clientY)) {
        draggedRef.current = true;
      }
      setPosition(positionForPointer(session, moveEvent.clientX, moveEvent.clientY, elementNode));
    }, { signal: abortController.signal });
    document.addEventListener('pointerup', () => stopDragSession(draggedRef.current), { signal: abortController.signal });
    document.addEventListener('pointercancel', () => stopDragSession(draggedRef.current), { signal: abortController.signal });
  }, [position, storageKey, elementNode]);

  const consumeDragClick = useCallback(() => {
    if (!draggedRef.current) {
      return false;
    }
    draggedRef.current = false;
    return true;
  }, []);

  return { position, startDrag, consumeDragClick, dragRef };
}
