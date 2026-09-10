/**
 * The Up-next rail shows a first page and grows by a page on each "+N more"
 * (Valerie, 2026-09-10: "+141 more" opens the next 50 with "+91 more" under it).
 */
export const UP_NEXT_FIRST = 8;
export const UP_NEXT_PAGE = 50;

/**
 * How many of `total` to show after `expansions` clicks, and how many remain.
 * @param total - Items in the rail (the queue minus the current one).
 * @param expansions - Times "+N more" has been clicked.
 */
export function upNextPage(total: number, expansions: number): { shown: number; remaining: number } {
  const shown = Math.min(total, UP_NEXT_FIRST + expansions * UP_NEXT_PAGE);
  return { shown, remaining: total - shown };
}
