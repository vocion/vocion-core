/**
 * The team report's categorical palette — eight hues in a FIXED order, each
 * with a light-surface and a dark-surface step. Validated with the dataviz
 * palette checker (lightness band, chroma floor, CVD separation, normal-
 * vision floor) on both surfaces; three light steps sit under 3:1 contrast
 * against white, which is why every segment always carries a text legend
 * and never relies on hue alone.
 *
 * Color follows the ENTITY, never its rank: slots are assigned by sorting
 * the entities by slug, so a team keeps its hue when its spend moves.
 */

export type Swatch = { light: string; dark: string };

export const CATEGORICAL: readonly Swatch[] = [
  { light: '#2a78d6', dark: '#3987e5' }, // blue
  { light: '#eb6834', dark: '#d95926' }, // orange
  { light: '#1baf7a', dark: '#199e70' }, // aqua
  { light: '#eda100', dark: '#c98500' }, // yellow
  { light: '#e87ba4', dark: '#d55181' }, // magenta
  { light: '#008300', dark: '#008300' }, // green
  { light: '#4a3aa7', dark: '#9085e9' }, // violet
  { light: '#e34948', dark: '#e66767' }, // red
];

/** The "everything else" fold — a neutral, never a ninth hue. */
export const OTHER: Swatch = { light: '#9a9a96', dark: '#6f6f6b' };

/**
 * Assign each slug a swatch by its position in the SORTED slug list. Past
 * eight entities the caller folds the tail into "Other" (see WeightStrip);
 * this never generates a ninth hue.
 * @param slugs - Entity ids to color.
 */
export function assignSwatches(slugs: string[]): Map<string, Swatch> {
  const sorted = [...new Set(slugs)].sort();
  return new Map(sorted.map((s, i) => [s, CATEGORICAL[i % CATEGORICAL.length]!]));
}
