/**
 * WHEN THE PHONE'S SIDEBAR DRAWER CLOSES BY ITSELF (founder, 2026-10-09: "We
 * keep having that problem. Global solution.").
 *
 * One rule, in one place, instead of a `setOpenMobile(false)` in every link:
 *
 * 1. Any navigation closes it. The sidebar provider watches the route
 *    (pathname or query) and closes the drawer when it changes, however the
 *    navigation started: a link, a menu item, code calling the router.
 * 2. Activating a link closes it, even one to the page already showing (the
 *    route does not change, so rule 1 would not fire). Anything else that
 *    leaves the drawer behind without being a link — a workspace switch that
 *    reloads the page — says so with {@link DRAWER_CLOSE_ATTR}.
 *
 * The drawer's own controls stay put: a toggle, a "More" menu, a pin, the
 * manage view's "Back" are buttons, not links, and are not marked.
 * Click events reach the drawer through React's tree, so a popover or menu
 * portaled out of the drawer's DOM (the workspace picker, a "More" list)
 * still counts as inside it.
 */

/** Put on a non-link control whose activation leaves the drawer behind. */
export const DRAWER_CLOSE_ATTR = 'data-drawer-close';

type ClickLike = { target: EventTarget | null; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number };

/**
 * Whether this click, somewhere inside the drawer, should close it.
 * @param event - The click (a DOM or React mouse event).
 */
export function clickClosesDrawer(event: ClickLike): boolean {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  const target = event.target as Element | null;
  if (!target || typeof target.closest !== 'function') {
    return false;
  }
  const marked = target.closest(`[${DRAWER_CLOSE_ATTR}]`);
  if (marked) {
    return marked.getAttribute(DRAWER_CLOSE_ATTR) !== 'false';
  }
  const anchor = target.closest('a[href]') as HTMLAnchorElement | null;
  if (!anchor) {
    return false;
  }
  // A new tab or a download leaves this page where it is, drawer included.
  return !(anchor.target && anchor.target !== '_self') && !anchor.hasAttribute('download');
}
