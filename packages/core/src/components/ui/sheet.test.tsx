import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { Sheet, SheetContent, SheetDescription, SheetGrabber, SheetTitle } from './sheet';

function drag(el: Element, from: number, to: number, ms: number) {
  const at = performance.now();
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: from, pointerId: 1 }));
  el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 100, clientY: to, pointerId: 1 }));
  // The flick speed is read off the event clock; a slow drag waits.
  return new Promise<void>(resolve => setTimeout(() => {
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 100, clientY: to, pointerId: 1 }));
    resolve();
  }, Math.max(0, ms - (performance.now() - at))));
}

function sheet(onDismiss: () => void) {
  return (
    <Sheet open>
      <SheetContent side="bottom" style={{ height: 600 }}>
        <SheetGrabber onDismiss={onDismiss} />
        <SheetTitle>Chat</SheetTitle>
        <SheetDescription>Workspace chat</SheetDescription>
      </SheetContent>
    </Sheet>
  );
}

describe('a bottom sheet\'s grabber (Chris, 2026-09-29: "It should allow drag to close")', () => {
  it('closes the sheet when dragged down past a quarter of its height', async () => {
    const onDismiss = vi.fn();
    render(sheet(onDismiss));
    const grabber = await vi.waitFor(() => {
      const g = document.querySelector('[data-slot="sheet-grabber"]');
      if (!g) {
        throw new Error('not rendered yet');
      }
      return g;
    });

    await drag(grabber, 100, 400, 600);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('springs back from a short, slow drag', async () => {
    const onDismiss = vi.fn();
    render(sheet(onDismiss));
    const grabber = await vi.waitFor(() => {
      const g = document.querySelector('[data-slot="sheet-grabber"]');
      if (!g) {
        throw new Error('not rendered yet');
      }
      return g;
    });

    await drag(grabber, 100, 140, 600);

    expect(onDismiss).not.toHaveBeenCalled();
    expect((document.querySelector('[data-slot="sheet-content"]') as HTMLElement).style.transform).toBe('');
  });
});
