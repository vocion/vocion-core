/**
 * THE HEADING FONTS AN ORG MAY PICK — a short allowlist, every one served by
 * this app.
 *
 * A brand guide can name any font (documents load what they like from a
 * stylesheet), but the app itself never fetches a font at runtime from a
 * third party: each face here is either a self-hosted WOFF2 that `next/font`
 * downloads at build time and serves from `/_next/static/media`
 * (`app/[locale]/layout.tsx` declares them, unpreloaded, so a face nobody picked
 * costs a few lines of CSS and no download), or the operating system's own
 * stack. A name not on the list is kept in the guide for documents and the
 * app draws headings in its own face.
 *
 * Pure data, shared by the server (the brand's CSS) and the Brand settings
 * page (the picker).
 */

export type HeadingFont = {
  /** Stable id, stored nowhere: the guide stores the family name. */
  id: string;
  /** The family name as a brand guide writes it, and as the picker shows it. */
  family: string;
  /** The CSS `font-family` value. A self-hosted face reads its `next/font` variable. */
  stack: string;
  /** Self-hosted (`next/font`, built in) or the device's own. */
  source: 'self-hosted' | 'system';
};

const SANS_TAIL = 'ui-sans-serif, system-ui, -apple-system, \'Segoe UI\', sans-serif';
const SERIF_TAIL = 'ui-serif, Georgia, \'Times New Roman\', serif';

export const HEADING_FONTS: readonly HeadingFont[] = [
  { id: 'inter', family: 'Inter', stack: `var(--font-inter), ${SANS_TAIL}`, source: 'self-hosted' },
  { id: 'outfit', family: 'Outfit', stack: `var(--font-outfit), ${SANS_TAIL}`, source: 'self-hosted' },
  { id: 'barlow', family: 'Barlow', stack: `var(--font-barlow), ${SANS_TAIL}`, source: 'self-hosted' },
  { id: 'manrope', family: 'Manrope', stack: `var(--font-manrope), ${SANS_TAIL}`, source: 'self-hosted' },
  { id: 'space-grotesk', family: 'Space Grotesk', stack: `var(--font-space-grotesk), ${SANS_TAIL}`, source: 'self-hosted' },
  { id: 'ibm-plex-sans', family: 'IBM Plex Sans', stack: `var(--font-ibm-plex-sans), ${SANS_TAIL}`, source: 'self-hosted' },
  { id: 'fraunces', family: 'Fraunces', stack: `var(--font-fraunces), ${SERIF_TAIL}`, source: 'self-hosted' },
  { id: 'source-serif-4', family: 'Source Serif 4', stack: `var(--font-source-serif-4), ${SERIF_TAIL}`, source: 'self-hosted' },
  { id: 'system-sans', family: 'System sans-serif', stack: SANS_TAIL, source: 'system' },
  { id: 'system-serif', family: 'System serif', stack: SERIF_TAIL, source: 'system' },
];

/**
 * The allowlisted face a family name names, matched without regard to case or
 * spacing ("source serif 4", "SourceSerif4"); null when it is not one.
 * @param family - A family name from a brand guide, or an allowlist id.
 */
export function headingFontFor(family: string | null | undefined): HeadingFont | null {
  if (!family) {
    return null;
  }
  const key = family.toLowerCase().replace(/[^a-z0-9]/g, '');
  return HEADING_FONTS.find(f => f.id.replace(/-/g, '') === key || f.family.toLowerCase().replace(/[^a-z0-9]/g, '') === key) ?? null;
}
