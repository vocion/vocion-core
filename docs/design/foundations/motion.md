# Motion

Motion says what changed or what is working; nothing loops when nothing is
working, nothing bounces. Every rule below has a reduced-motion form that keeps
the meaning and drops the movement. The CSS is in `styles/global.css`.

| Moment | Motion | Reduced motion |
|---|---|---|
| A turn arrives (`.turn-enter`) | Fades in and rises 4px, 180ms ease-out | In place |
| An agent starts working (`AgentDot working`) | The spark blooms over its colour from the centre, 600ms; turns (3.2s) and breathes (2.4s) | The spark shows, still |
| The work ends (`AgentDot settling`) | The spark fades and shrinks back, 900ms | It goes |
| The thinking line (`.work-shimmer`) | A spark band sweeps the words, 2.4s | Plain muted text |
| The composer while a turn runs (`.composer-working`) | Its edge is the spark, drifting, 4s | Still |
| A region a turn changed (`[data-version-changed='fade']`) | A rose-to-violet wash, 2s | A still outline |
| Page navigation (`.nav-progress`) | A bar sweeps to ~85% over 8s, then completes and fades | A static bar |
| Buttons and hovers | A 150ms background fade | Same |
| Popovers and menus | Fade and zoom from 95% | Same (Radix) |
