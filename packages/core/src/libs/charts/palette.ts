/**
 * The categorical palette for data, in fixed slot order — slot n is the nth
 * series, never cycled (the spec caps series at eight). Light and dark steps
 * of the same hue, pre-validated in both modes (dataviz palette reference).
 * The card reads them as `--viz-n` custom properties; a document or deck
 * embeds the light hex directly.
 */

/** The categorical palette, light steps, in fixed slot order (`--viz-1…8` on screen). */
export const VIZ_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'] as const;
/** The same slots' dark-mode steps. */
export const VIZ_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'] as const;

/**
 * Light / dark categorical steps — slot n → `--viz-n`. Written out literally
 * so Tailwind sees every class; the same values as `VIZ_LIGHT` / `VIZ_DARK`
 * above (a test holds them equal).
 */
export const VIZ_VARS = [
  '[--viz-1:#2a78d6] dark:[--viz-1:#3987e5]',
  '[--viz-2:#eb6834] dark:[--viz-2:#d95926]',
  '[--viz-3:#1baf7a] dark:[--viz-3:#199e70]',
  '[--viz-4:#eda100] dark:[--viz-4:#c98500]',
  '[--viz-5:#e87ba4] dark:[--viz-5:#d55181]',
  '[--viz-6:#008300] dark:[--viz-6:#008300]',
  '[--viz-7:#4a3aa7] dark:[--viz-7:#9085e9]',
  '[--viz-8:#e34948] dark:[--viz-8:#e66767]',
].join(' ');
