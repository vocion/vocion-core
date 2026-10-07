/**
 * WHICH PICTURES LEAD A FEATURE PAGE (Chris, 2026-10-04: "That's a lot of QA
 * images. We don't need everything, at least not in the primary carousel.
 * Just enough to show the feature works.").
 *
 * The pictures that show the feature works are the ones QA cited when it
 * judged each acceptance line: one per line, in the contract's order. Those
 * lead. Everything else QA shot — the before shots, the browser tests'
 * states, the duplicates — stays with the criteria and the QA record, one
 * tap away. Before a verdict exists there is nothing cited, so the page
 * shows what it has: what shipped, a few of QA's after-shots, the product
 * today, the mockup.
 */

/** What the picker reads off a picture. */
export type HeroPicture = { id: number; imageUrl: string | null; url: string | null; section?: string; role: string; sameAs?: readonly number[] };
/** What the picker reads off a judged acceptance line. */
export type HeroCriterion = { state: 'unverified' | 'passed' | 'failed'; evidence: string | null; evidenceUrl: string | null };

/** How many of QA's after-shots lead when nothing has been cited yet. */
export const UNCITED_QA_PICTURES = 4;

/**
 * Whether a criterion's evidence names this picture: by its artifact id as a
 * whole number (QA cites "1008" or "artifact #1008", the shot's own id), or
 * by its address (the image, or its artifact page).
 * @param c - The judged line.
 * @param p - The picture.
 */
function cites(c: HeroCriterion, p: HeroPicture): boolean {
  const text = `${c.evidence ?? ''} ${c.evidenceUrl ?? ''}`;
  // A cited copy of the same picture is this one: the page keeps one of identical shots
  // (`oneOfEachPicture`), and QA may have cited the other (FE-472 cited 4135; 4136 was kept).
  const ids = new Set([p.id, ...(p.sameAs ?? [])]);
  if ([...text.matchAll(/\b(\d{2,})\b/g)].some(m => ids.has(Number(m[1])))) {
    return true;
  }
  return [p.imageUrl, p.url].some(u => u !== null && u.length > 8 && text.includes(u));
}

/**
 * The pictures for the hero carousel, in order: what shipped, the ones QA
 * cited for each acceptance line (passed or failed, the contract's order, each
 * once), then the mockup and the rest that are not QA's shots; when none is
 * cited, the pictures that are not QA's shots plus the first few of QA's
 * after-shots.
 * @param pictures - Every picture the page could show, already ranked best first.
 * @param criteria - The acceptance lines as judged, items then risks.
 */
export function heroPictures<P extends HeroPicture>(pictures: readonly P[], criteria: readonly HeroCriterion[]): P[] {
  const cited: P[] = [];
  for (const c of criteria) {
    if (c.state === 'unverified') {
      continue;
    }
    const hit = pictures.find(p => !cited.includes(p) && cites(c, p));
    if (hit) {
      cited.push(hit);
    }
  }
  const qa = (p: HeroPicture) => p.role === 'qa-screenshot';
  if (cited.length > 0) {
    // What shipped leads, then what QA cited in the contract's order, then the rest that is not
    // QA's: the mockup and the product as it was (Chris, 2026-10-06: "features are missing the
    // mocks from the media carousel"; cited pictures used to be all there was).
    return [...pictures.filter(p => p.role === 'shipped'), ...cited, ...pictures.filter(p => !qa(p) && p.role !== 'shipped')];
  }
  const rest = pictures.filter(p => !qa(p));
  const after = pictures.filter(p => qa(p) && p.section === 'QA after').slice(0, UNCITED_QA_PICTURES);
  // Keep the ranking the page gave them: what shipped first, QA's shot of the change, then the rest.
  return pictures.filter(p => rest.includes(p) || after.includes(p));
}
