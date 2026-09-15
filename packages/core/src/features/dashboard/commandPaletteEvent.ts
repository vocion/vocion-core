/** Fired by anything that wants the ⌘K palette open (the header search button). */
export const COMMAND_PALETTE_EVENT = 'vocion:open-command-palette';

/** Open the ⌘K palette from anywhere on the page. */
export function openCommandPalette(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(COMMAND_PALETTE_EVENT));
  }
}
