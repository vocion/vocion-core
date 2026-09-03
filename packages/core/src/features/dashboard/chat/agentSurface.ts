/**
 * The ONE function every agent-surface entry point goes through
 * (agent-chat-surface.md §6): the hotkey, a titlebar control, the rail, and
 * a record page's own affordances all call `requestAgentSurface()` instead of
 * reaching for a particular surface. A page that already carries a surface
 * (the dock on a record page, the shell on /dashboard/chat, the floating
 * bubble elsewhere) claims the request by cancelling the event and focuses
 * itself; an unclaimed request means no surface is mounted and the caller
 * falls back to navigating to the everything-scoped chat page.
 */

export const AGENT_SURFACE_EVENT = 'vocion:open-agent-surface';

/**
 * Ask whatever agent surface is mounted on this page to open and take focus.
 * @returns true when a mounted surface claimed the request; false when the
 * caller should navigate to /dashboard/chat instead.
 */
export function requestAgentSurface(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const event = new CustomEvent(AGENT_SURFACE_EVENT, { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/**
 * Focus the agent composer inside a container (every surface marks its
 * textarea with `data-agent-composer`). Retries across a few frames because
 * a surface that just opened (the bubble's panel, an un-collapsed dock) may
 * not have rendered its composer on the first one.
 * @param container - The surface's root element, or null to search the page.
 */
export function focusAgentComposer(container: HTMLElement | null): void {
  let attempts = 12;
  const tryFocus = () => {
    const el = (container ?? document).querySelector<HTMLTextAreaElement>('[data-agent-composer]');
    if (el) {
      el.focus();
      return;
    }
    attempts -= 1;
    if (attempts > 0) {
      requestAnimationFrame(tryFocus);
    }
  };
  requestAnimationFrame(tryFocus);
}
