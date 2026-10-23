/**
 * The render page for a deck: every slide in its own 1920×1080 frame, the
 * deck's Google Fonts, `asset:<id>` resolved to a URL, Vocion's element
 * runtime inlined, and print CSS that makes each slide exactly one PDF page.
 *
 * The same page serves the renderer (screenshots, audit, PDF), the PPTX
 * layout pass and a viewer; only `assetUrl` differs — the renderer routes
 * assets to their stored bytes, a viewer to their served URLs.
 *
 * Pure: a spec in, a string out.
 */

import type { DeckSpec } from '@/libs/cards/specs';
import { iconTable } from './icons';
import { DECK_RUNTIME } from './runtime';
import { escapeHtml, iconNamesIn, normaliseSlideHtml } from './slides';

export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;
/** Below this line only the footer band may sit (`audit.ts`). */
export const FOOTER_LINE_Y = 920;

export type DeckPageOptions = {
  /** The URL an `asset:<id>` resolves to, or null to leave it unresolved (the audit then names it). */
  assetUrl: (id: string) => string | null;
  /** Gap between slides on screen, px (print always has none). Default 40. */
  gap?: number;
  /** Background behind the slides on screen. Default a neutral grey. */
  backdrop?: string;
};

/**
 * Replace every `asset:<id>` reference (src, href, url()) with its URL.
 * @param html - One slide.
 * @param assetUrl - The resolver.
 */
export function resolveAssets(html: string, assetUrl: (id: string) => string | null): string {
  return html.replace(/asset:([\w.-]{1,80})/g, (whole, id: string) => {
    const url = assetUrl(id);
    return url === null ? whole : url.replace(/"/g, '%22');
  });
}

/**
 * The stylesheet every render page carries. The slide's own styling is inline.
 * @param opts
 * @param opts.gap
 * @param opts.backdrop
 */
function frameCss(opts: { gap: number; backdrop: string }): string {
  return [
    `@page { size: ${SLIDE_WIDTH}px ${SLIDE_HEIGHT}px; margin: 0 }`,
    '*, *::before, *::after { box-sizing: border-box }',
    `html, body { margin: 0; padding: 0; background: ${opts.backdrop}; -webkit-print-color-adjust: exact; print-color-adjust: exact }`,
    `.vocion-slide { position: relative; width: ${SLIDE_WIDTH}px; height: ${SLIDE_HEIGHT}px; overflow: hidden; margin: 0 auto ${opts.gap}px; background: #fff; break-after: page; page-break-after: always }`,
    '.vocion-slide:last-child { margin-bottom: 0; break-after: auto; page-break-after: auto }',
    `.vocion-slide > section { position: relative; width: ${SLIDE_WIDTH}px; height: ${SLIDE_HEIGHT}px; margin: 0; overflow: visible }`,
    '.vocion-slide aside { display: none !important }',
    'x-icon { display: inline-block; line-height: 0 } x-shape { display: block } x-connector { display: block }',
    'img { max-width: none }',
    '@media print { html, body { background: none } .vocion-slide { margin: 0 } }',
  ].join('\n');
}

/**
 * The deck as one HTML page.
 * @param spec - The deck (only `title`, `order`, `slides`, `faces` are read).
 * @param opts - How assets resolve, and the screen layout.
 */
export function buildDeckPage(spec: Pick<DeckSpec, 'title' | 'order' | 'slides' | 'faces'>, opts: DeckPageOptions): string {
  const names = new Set<string>();
  for (const id of spec.order) {
    for (const n of iconNamesIn(spec.slides[id] ?? '')) {
      names.add(n);
    }
  }
  const fonts = Object.values(spec.faces ?? {})
    .map(f => f.href)
    .filter(href => /^https:\/\/fonts\.googleapis\.com\/css2\?/.test(href))
    .map(href => `<link rel="stylesheet" href="${href.replace(/"/g, '%22')}">`)
    .join('\n');
  const slides = spec.order.map((id, i) => {
    const html = resolveAssets(normaliseSlideHtml(spec.slides[id] ?? ''), opts.assetUrl);
    return `<div class="vocion-slide" data-slide-id="${escapeHtml(id)}" data-n="${i + 1}">${html}</div>`;
  }).join('\n');
  // `</script>` cannot appear inside the JSON, since icon markup is path data; escape `<` anyway.
  const icons = JSON.stringify(iconTable(names)).replace(/</g, '\\u003c');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(spec.title)}</title>
${fonts.length ? `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n${fonts}` : ''}
<style>${frameCss({ gap: opts.gap ?? 40, backdrop: opts.backdrop ?? '#d9d9d6' })}</style>
</head><body>
${slides}
<script>window.__VOCION_ICONS = ${icons};</script>
<script>${DECK_RUNTIME}</script>
</body></html>`;
}
