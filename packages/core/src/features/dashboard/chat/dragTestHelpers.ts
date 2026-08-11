/**
 * Fires the same pointerdown → pointermove → pointerup sequence a real
 * mouse drag produces, for tests exercising `useDraggablePosition`. The
 * hook listens on `document` for move/up (so dragging still tracks once
 * the pointer leaves the draggable element), so those two dispatch on
 * `document` while pointerdown dispatches on the drag handle itself.
 * @param target - The element the drag starts on (the drag handle).
 * @param from - Pointer coordinates where the drag begins.
 * @param from.x - Starting X coordinate.
 * @param from.y - Starting Y coordinate.
 * @param to - Pointer coordinates where the drag ends.
 * @param to.x - Ending X coordinate.
 * @param to.y - Ending Y coordinate.
 */
export function dispatchPointerDrag(target: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
  dispatchPointerDragEndingWith(target, from, to, 'pointerup');
}

/**
 * Same drag sequence as `dispatchPointerDrag`, but ends with `pointercancel`
 * instead of `pointerup` — simulates the browser stealing the gesture
 * (scroll takeover, tab switch, alt-tab) partway through a drag.
 * @param target - The element the drag starts on (the drag handle).
 * @param from - Pointer coordinates where the drag begins.
 * @param from.x - Starting X coordinate.
 * @param from.y - Starting Y coordinate.
 * @param to - Pointer coordinates where the drag is interrupted.
 * @param to.x - Ending X coordinate.
 * @param to.y - Ending Y coordinate.
 */
export function dispatchCancelledPointerDrag(target: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
  dispatchPointerDragEndingWith(target, from, to, 'pointercancel');
}

function dispatchPointerDragEndingWith(target: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }, endEventType: 'pointerup' | 'pointercancel') {
  const pointerId = 1;
  target.dispatchEvent(new PointerEvent('pointerdown', {
    clientX: from.x,
    clientY: from.y,
    pointerId,
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerType: 'mouse',
  }));
  document.dispatchEvent(new PointerEvent('pointermove', {
    clientX: to.x,
    clientY: to.y,
    pointerId,
    bubbles: true,
    cancelable: true,
    pointerType: 'mouse',
  }));
  document.dispatchEvent(new PointerEvent(endEventType, {
    clientX: to.x,
    clientY: to.y,
    pointerId,
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerType: 'mouse',
  }));
}

/**
 * Fires the click a real browser sends right after a mouseup — dispatch
 * after `dispatchPointerDrag` to test drag-vs-click suppression.
 * @param target - The element to click.
 */
export function dispatchClick(target: HTMLElement) {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}
