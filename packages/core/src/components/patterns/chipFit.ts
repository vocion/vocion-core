/**
 * How many chips fit on one line. Pure, so the "+N more" rule is testable
 * without a browser; `ChipRow` measures the real widths and asks.
 *
 * Every chip is `width + gap`. When all of them fit, all are shown. Otherwise
 * the "+N more" control takes the end of the line, and as many chips as fit
 * before it are shown — in the order given, which `ChipRow` has already
 * arranged pinned-first, active-next, so an active chip is never the one
 * hidden.
 * @param widths - Measured chip widths in order.
 * @param container - Available width.
 * @param more - Measured width of the "+N more" control.
 * @param gap - Gap between chips.
 * @returns The number of leading chips to show.
 */
export function fitChips(widths: readonly number[], container: number, more: number, gap: number): number {
  const total = widths.reduce((sum, w, i) => sum + w + (i > 0 ? gap : 0), 0);
  if (total <= container) {
    return widths.length;
  }
  let used = 0;
  let n = 0;
  for (const w of widths) {
    const next = used + (n > 0 ? gap : 0) + w;
    if (next + gap + more > container) {
      break;
    }
    used = next;
    n += 1;
  }
  return n;
}

export type ChipLike = { key: string; active: boolean; pinned?: boolean };

/**
 * The order chips are laid out in: pinned ("All") first, then active, then
 * the rest, each group keeping its given order. An active chip can then
 * never fall into the overflow while an inactive one is shown.
 * @param chips
 */
export function arrangeChips<T extends ChipLike>(chips: readonly T[]): T[] {
  return [...chips.filter(c => c.pinned), ...chips.filter(c => !c.pinned && c.active), ...chips.filter(c => !c.pinned && !c.active)];
}
