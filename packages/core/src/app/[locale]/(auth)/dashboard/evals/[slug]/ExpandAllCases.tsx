'use client';

/**
 * "Expand all" / "Collapse all" for the case list.
 *
 * The only client code the case list needs: each case is a native
 * `<details>`, rendered on the server, and this island just flips `open` on
 * all of them at once — so the cards themselves stay server-rendered.
 */

/**
 * Open or close every case in the list this toggle belongs to.
 * @param button - The button pressed, used to find its list.
 * @param open - Whether to open them.
 */
function setAllCases(button: HTMLButtonElement, open: boolean): void {
  const list = button.closest('[data-case-list]');
  for (const details of list?.querySelectorAll<HTMLDetailsElement>('details[data-testid="eval-case"]') ?? []) {
    details.open = open;
  }
}

export function ExpandAllCases() {
  const buttonClass = 'rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50';
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className={buttonClass} onClick={event => setAllCases(event.currentTarget, true)}>Expand all</button>
      <button type="button" className={buttonClass} onClick={event => setAllCases(event.currentTarget, false)}>Collapse all</button>
    </div>
  );
}
