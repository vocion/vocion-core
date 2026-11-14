/**
 * reveal.js and its core stylesheet, in one module present mode loads with a
 * dynamic `import()` when it opens: nobody who never presents downloads it.
 * Only the core CSS — no reveal theme, so nothing restyles a slide (and the
 * slides are sandboxed frames that no outside style reaches anyway), plus
 * one rule that keeps Tailwind's preflight from hiding a slide mid-transition.
 */

import 'reveal.js/dist/reveal.css';
import './revealDeck.css';

export { default as Reveal } from 'reveal.js';
