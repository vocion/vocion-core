import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { dispatchCancelledPointerDrag, dispatchClick, dispatchPointerDrag } from './dragTestHelpers';
import { useDraggablePosition } from './useDraggablePosition';

const STORAGE_KEY = 'test_drag_position';

type DragTargetProps = {
  storageKey: string;
  onClick: () => void;
};

function DragTarget({ storageKey, onClick }: DragTargetProps) {
  const { position, startDrag, consumeDragClick, dragRef } = useDraggablePosition(storageKey);

  return (
    <button
      ref={dragRef}
      type="button"
      onPointerDown={startDrag}
      onClick={() => {
        if (consumeDragClick()) {
          return;
        }
        onClick();
      }}
      style={{ position: 'fixed', right: `${position.right}px`, bottom: `${position.bottom}px`, width: '40px', height: '40px' }}
    >
      drag me
    </button>
  );
}

/**
 * Same drag handle, toggles between a small and a large size in place — mirrors normal ↔ maximized on the chat panel, which is one persistent div.
 * @param root0
 * @param root0.storageKey
 */
function ResizableDragTarget({ storageKey }: { storageKey: string }) {
  const { position, startDrag, dragRef } = useDraggablePosition(storageKey);
  const [large, setLarge] = useState(false);

  return (
    <>
      {/* Pinned opposite the corner the drag test below parks `target` in, so growing/clicking never fights the dragged element for pointer events. */}
      <button type="button" onClick={() => setLarge(true)} style={{ position: 'fixed', bottom: 0, right: 0 }}>grow</button>
      <div
        ref={dragRef}
        onPointerDown={startDrag}
        style={{ position: 'fixed', right: `${position.right}px`, bottom: `${position.bottom}px`, width: large ? '300px' : '40px', height: large ? '300px' : '40px' }}
      >
        target
      </div>
    </>
  );
}

/**
 * Swaps the drag handle for a differently-sized element entirely — mirrors the collapsed button being replaced by the panel div.
 * @param root0
 * @param root0.storageKey
 */
function SwappableDragTarget({ storageKey }: { storageKey: string }) {
  const { position, startDrag, dragRef } = useDraggablePosition(storageKey);
  const [swapped, setSwapped] = useState(false);

  if (swapped) {
    return (
      <div
        ref={dragRef}
        onPointerDown={startDrag}
        style={{ position: 'fixed', right: `${position.right}px`, bottom: `${position.bottom}px`, width: '300px', height: '300px' }}
      >
        panel
      </div>
    );
  }

  return (
    <>
      {/* Pinned opposite the corner the drag test below parks `small` in, so swapping/clicking never fights the dragged element for pointer events. */}
      <button type="button" onClick={() => setSwapped(true)} style={{ position: 'fixed', bottom: 0, right: 0 }}>swap</button>
      <button
        ref={dragRef}
        onPointerDown={startDrag}
        type="button"
        style={{ position: 'fixed', right: `${position.right}px`, bottom: `${position.bottom}px`, width: '40px', height: '40px' }}
      >
        small
      </button>
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('useDraggablePosition', () => {
  it('defaults to the bottom-right corner', async () => {
    await render(<DragTarget storageKey={STORAGE_KEY} onClick={vi.fn()} />);
    const target = page.getByRole('button', { name: 'drag me' }).element() as HTMLElement;

    await vi.waitFor(() => {
      expect(target.style.right).toBe('16px');
      expect(target.style.bottom).toBe('16px');
    });
  });

  it('hydrates from a persisted position on mount', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ right: 120, bottom: 200 }));
    await render(<DragTarget storageKey={STORAGE_KEY} onClick={vi.fn()} />);
    const target = page.getByRole('button', { name: 'drag me' }).element() as HTMLElement;

    await vi.waitFor(() => {
      expect(target.style.right).toBe('120px');
      expect(target.style.bottom).toBe('200px');
    });
  });

  it('dragging past the movement threshold repositions the element and persists it', async () => {
    await render(<DragTarget storageKey={STORAGE_KEY} onClick={vi.fn()} />);
    const target = page.getByRole('button', { name: 'drag me' }).element() as HTMLElement;

    dispatchPointerDrag(target, { x: 200, y: 200 }, { x: 150, y: 160 });

    // Pointer moved 50px left and 40px up: right grows by 50, bottom grows by 40.
    await vi.waitFor(() => {
      expect(target.style.right).toBe('66px');
      expect(target.style.bottom).toBe('56px');
    });
    await vi.waitFor(() => {
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({ right: 66, bottom: 56 });
    });
  });

  it('a tiny movement under the drag threshold does not move the element or block the click', async () => {
    const onClick = vi.fn();
    await render(<DragTarget storageKey={STORAGE_KEY} onClick={onClick} />);
    const target = page.getByRole('button', { name: 'drag me' }).element() as HTMLElement;

    dispatchPointerDrag(target, { x: 200, y: 200 }, { x: 201, y: 200 });
    dispatchClick(target);

    await vi.waitFor(() => expect(onClick).toHaveBeenCalledOnce());

    expect(target.style.right).toBe('16px');
    expect(target.style.bottom).toBe('16px');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('a real drag suppresses the click that follows pointerup', async () => {
    const onClick = vi.fn();
    await render(<DragTarget storageKey={STORAGE_KEY} onClick={onClick} />);
    const target = page.getByRole('button', { name: 'drag me' }).element() as HTMLElement;

    dispatchPointerDrag(target, { x: 200, y: 200 }, { x: 150, y: 150 });
    dispatchClick(target);

    await vi.waitFor(() => {
      expect(target.style.right).toBe('66px');
    });

    expect(onClick).not.toHaveBeenCalled();
  });

  it('a click with no prior drag still fires normally', async () => {
    const onClick = vi.fn();
    await render(<DragTarget storageKey={STORAGE_KEY} onClick={onClick} />);
    const target = page.getByRole('button', { name: 'drag me' }).element() as HTMLElement;

    dispatchClick(target);

    await vi.waitFor(() => expect(onClick).toHaveBeenCalledOnce());
  });

  it('clamps the low end so the element cannot be dragged past the opposite edge', async () => {
    await render(<DragTarget storageKey={STORAGE_KEY} onClick={vi.fn()} />);
    const target = page.getByRole('button', { name: 'drag me' }).element() as HTMLElement;

    // Drag far down-and-right — pushes right/bottom offsets toward negative,
    // which must clamp at the 8px edge margin rather than go off-screen.
    dispatchPointerDrag(target, { x: 200, y: 200 }, { x: 100000, y: 100000 });

    await vi.waitFor(() => {
      expect(target.style.right).toBe('8px');
      expect(target.style.bottom).toBe('8px');
    });
  });

  it('clamps the high end so the element cannot be dragged past the far edge', async () => {
    await render(<DragTarget storageKey={STORAGE_KEY} onClick={vi.fn()} />);
    const target = page.getByRole('button', { name: 'drag me' }).element() as HTMLElement;
    const expectedMaxRight = Math.max(8, window.innerWidth - target.offsetWidth - 8);
    const expectedMaxBottom = Math.max(8, window.innerHeight - target.offsetHeight - 8);

    // Drag far up-and-left — pushes right/bottom offsets toward the far edge.
    dispatchPointerDrag(target, { x: 200, y: 200 }, { x: -100000, y: -100000 });

    await vi.waitFor(() => {
      expect(target.style.right).toBe(`${expectedMaxRight}px`);
      expect(target.style.bottom).toBe(`${expectedMaxBottom}px`);
    });
  });

  it('a pointercancel (browser stealing the gesture) ends the drag and stops tracking further pointer moves', async () => {
    await render(<DragTarget storageKey={STORAGE_KEY} onClick={vi.fn()} />);
    const target = page.getByRole('button', { name: 'drag me' }).element() as HTMLElement;

    dispatchCancelledPointerDrag(target, { x: 200, y: 200 }, { x: 150, y: 160 });

    await vi.waitFor(() => {
      expect(target.style.right).toBe('66px');
      expect(target.style.bottom).toBe('56px');
    });
    await vi.waitFor(() => {
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({ right: 66, bottom: 56 });
    });

    // The cancel already tore down the document-level listeners, so a
    // stray pointermove arriving afterwards (e.g. leftover from whatever
    // gesture stole the drag) must not move the element any further.
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 0, pointerId: 1, bubbles: true, cancelable: true, pointerType: 'mouse' }));

    expect(target.style.right).toBe('66px');
    expect(target.style.bottom).toBe('56px');
  });

  it('clamps a persisted position on mount instead of trusting a stale value that may now sit off-screen', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ right: 100000, bottom: 100000 }));
    await render(<DragTarget storageKey={STORAGE_KEY} onClick={vi.fn()} />);
    const target = page.getByRole('button', { name: 'drag me' }).element() as HTMLElement;
    const expectedMaxRight = Math.max(8, window.innerWidth - target.offsetWidth - 8);
    const expectedMaxBottom = Math.max(8, window.innerHeight - target.offsetHeight - 8);

    await vi.waitFor(() => {
      expect(target.style.right).toBe(`${expectedMaxRight}px`);
      expect(target.style.bottom).toBe(`${expectedMaxBottom}px`);
    });
  });

  it('re-clamps and re-persists when the drag handle grows in place (e.g. a maximize toggle)', async () => {
    await render(<ResizableDragTarget storageKey={STORAGE_KEY} />);
    const target = page.getByText('target').element() as HTMLElement;

    // Push it to the far edge at its small size.
    dispatchPointerDrag(target, { x: 200, y: 200 }, { x: -100000, y: -100000 });
    const smallMaxRight = Math.max(8, window.innerWidth - target.offsetWidth - 8);
    await vi.waitFor(() => expect(target.style.right).toBe(`${smallMaxRight}px`));

    await page.getByRole('button', { name: 'grow' }).click();

    const largeMaxRight = Math.max(8, window.innerWidth - target.offsetWidth - 8);

    expect(largeMaxRight).toBeLessThan(smallMaxRight);

    await vi.waitFor(() => {
      expect(target.style.right).toBe(`${largeMaxRight}px`);
    });
    await vi.waitFor(() => {
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toMatchObject({ right: largeMaxRight });
    });
  });

  it('re-clamps when the drag handle is swapped for a differently-sized element (e.g. button → panel)', async () => {
    await render(<SwappableDragTarget storageKey={STORAGE_KEY} />);
    const small = page.getByRole('button', { name: 'small' }).element() as HTMLElement;

    dispatchPointerDrag(small, { x: 200, y: 200 }, { x: -100000, y: -100000 });
    const smallMaxRight = Math.max(8, window.innerWidth - small.offsetWidth - 8);
    await vi.waitFor(() => expect(small.style.right).toBe(`${smallMaxRight}px`));

    await page.getByRole('button', { name: 'swap' }).click();

    const panel = page.getByText('panel').element() as HTMLElement;
    const panelMaxRight = Math.max(8, window.innerWidth - panel.offsetWidth - 8);

    expect(panelMaxRight).toBeLessThan(smallMaxRight);

    await vi.waitFor(() => {
      expect(panel.style.right).toBe(`${panelMaxRight}px`);
    });
  });
});
