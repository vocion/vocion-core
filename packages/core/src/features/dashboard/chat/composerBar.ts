/**
 * The composer bar's one alignment rule.
 *
 * Chris, 2026-09-18: *"tighten or clean up vertical alignment of elements in
 * chat bar"* — the `+`, the gauge, the placeholder and the send button were on
 * four different optical centres (measured at 1920: send 27px, `+`/gauge 29px,
 * the first text line 32.4px from the top of the box; a 5.4px spread), because
 * the row bottom-aligned three different heights — a 32px ghost, a 36px send
 * and a 24px box holding a 22.8px line.
 *
 * The rule, so there is one and not four:
 *
 *   **every control is {@link CONTROL_PX} tall, one text line is exactly
 *   {@link CONTROL_PX} tall ({@link LINE_PX} of line box plus symmetric
 *   padding), and the row bottom-aligns.**
 *
 * Bottom-aligned rather than centred on purpose: the box grows DOWNWARD as it
 * fills, so the controls belong beside the line the person is typing — the
 * last one — not floating at the middle of a paragraph. Because a single line
 * is exactly the control height, bottom-aligned and centred are the same
 * picture when the box is empty, and the controls' centre is the last line's
 * centre at every height after that.
 *
 * 32px is the repo's round-ghost control size (`PanelCloseButton`, the `+`
 * and the gauge already), so the send button joins them rather than the other
 * way round; it stays the primary action by fill, not by being bigger.
 */

/** Visual size of every round control in the bar, in px. */
export const CONTROL_PX = 32;
/** One line of composer text, in px. Fixed, so 14px and 16px text share a row. */
export const LINE_PX = 24;
/** Symmetric padding that makes one line as tall as one control. */
export const LINE_INSET_PX = (CONTROL_PX - LINE_PX) / 2;
/** The box stops at eight whole lines, so the cap never cuts a line in half. */
export const COMPOSER_MAX_PX = LINE_PX * 8 + LINE_INSET_PX * 2;

/**
 * Every round control in the bar: 32px visual, a 44px hit target on coarse
 * pointers (the pseudo-element grows the target without moving the box, which
 * a bigger control would — it has to stay one line tall), and a focus ring in
 * the repo's ring token so all four are reachable and visibly focused.
 *
 * Pair it with {@link COMPOSER_ROW} — that row opens the gap to 12px on coarse
 * pointers so two 44px targets sit side by side instead of overlapping.
 */
export const COMPOSER_CONTROL = 'relative flex size-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none pointer-coarse:before:absolute pointer-coarse:before:-inset-1.5 pointer-coarse:before:content-[\'\']';

/**
 * The row itself: one alignment rule, symmetric padding, touch-safe gaps.
 *
 * It WRAPS below `sm`, which is the whole mobile layout: the box takes the
 * first line on its own and the controls sit on a second line beneath it.
 * Side by side, a phone gave the message about two thirds of a 430px line
 * and the box grew upward from the bottom, so the placeholder floated above
 * two buttons pinned to the floor of a tall empty rounded rectangle — which
 * read as a broken control rather than a text field. Full width is also the
 * shape every messaging app on the device already uses.
 */
export const COMPOSER_ROW = 'flex flex-wrap items-end gap-1.5 pointer-coarse:gap-3 sm:flex-nowrap';
