/**
 * A STEP OF SETTING THE WORKSPACE UP CHANGED — an app added, a plugin turned
 * on, a role hired, an invite sent, or one of those undone. The Getting
 * started checklist and the shell re-read on it, so a step shows as done the
 * moment its Decision ran (`decisions/DoneReceipts`, `useChatSession`).
 */
export const SETUP_CHANGED_EVENT = 'vocion:workspace-setup-changed';

/** Tell the page a setup step changed (the checklist and the shell listen). */
export function announceSetupChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SETUP_CHANGED_EVENT));
  }
}
