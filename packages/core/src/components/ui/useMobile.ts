import * as React from 'react';

const MOBILE_BREAKPOINT = 768;

/**
 * Whether the viewport is narrower than `px`.
 *
 * ONE hook for a question four places were each answering with their own
 * `matchMedia` block — the sidebar's `useIsMobile`, `ChatDock`'s
 * `useNarrowViewport`, `PreviewPanel`'s copy of it, and (as of the stacked
 * artifact pane) `ConversationArtifactView`. They agreed on the semantics and
 * differed only in the number, which is the definition of one shape used
 * everywhere (design principle 6).
 *
 * It answers `false` on the server and until the first effect runs: there is no
 * viewport during the server render, and a hook that guessed would render one
 * layout and hydrate into another. A layout that must be right on the FIRST
 * paint belongs in a media query in CSS, not here — this hook is for the
 * decisions CSS cannot express, like which label a control carries.
 * @param px - The breakpoint, in px. Matches `max-width: px - 1`, so it is the
 * width at which the layout above the breakpoint starts — the same convention
 * Tailwind's own `sm`/`lg` use.
 */
export function useViewportBelow(px: number): boolean {
  const [below, setBelow] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${px - 1}px)`);
    const onChange = () => setBelow(mql.matches);
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setBelow(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [px]);

  return below;
}

export function useIsMobile(): boolean {
  return useViewportBelow(MOBILE_BREAKPOINT);
}
