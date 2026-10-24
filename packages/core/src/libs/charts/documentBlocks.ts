/**
 * Chart blocks in documents — so an agent never hand-writes chart SVG.
 *
 * In a document's HTML the author writes the spec, not the drawing:
 *
 *   <figure class="vocion-chart">
 *     <script type="application/json">{ "type": "bar", "x": [...], ... }</script>
 *   </figure>
 *
 * Before a document is verified and stored, every block is validated
 * (`chartSpecSchema`), checked (`checkChart`), and drawn from its spec at the
 * sheet's content width: the title, the SVG, the legend, the caption and a
 * hidden data table. The spec stays in the block, so the next edit — or the
 * next engine — redraws it from the spec, never from the old drawing. Only a
 * block whose data cannot be drawn honestly fails the write; what an analyst
 * would mention, and what the layout had to do, comes back as notes.
 *
 * It is a pass over the HTML with patterns for these blocks only: everything
 * else the author wrote passes through byte for byte.
 */

import { checkChart } from './checks';
import { layoutChart } from './layout';
import { factNotes } from './review';
import { chartSpecSchema } from './spec';
import { chartFigureInner } from './svg';

/** The width a sheet's content is laid out at: the 850px frame less the house margins. */
export const DOCUMENT_CHART_WIDTH = 720;

const BLOCK = /<figure(\s[^>]*\bclass\s*=\s*["'][^"']*\bvocion-chart\b[^"']*["'][^>]*)>([\s\S]*?)<\/figure>/gi;
const SPEC = /<script\s[^>]*type\s*=\s*["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i;
const STYLE_ATTR = 'data-vocion-charts';
const STYLE = new RegExp(`<style\\s[^>]*${STYLE_ATTR}[^>]*>[\\s\\S]*?<\\/style>\\s*`, 'gi');

/**
 * Tables and chart blocks that hold on a phone: the document frame scales a
 * sheet to the screen, so nothing may be wider than the sheet itself.
 */
const BASE_CSS = `<style ${STYLE_ATTR}>.vocion-chart{margin:12px 0;break-inside:avoid;position:relative}.vocion-chart svg{width:100%;height:auto}.sheet table{max-width:100%}.sheet td,.sheet th{overflow-wrap:anywhere}</style>`;

export type ChartBlockResult = {
  html: string;
  /** How many chart blocks the document has. */
  count: number;
  /** Schema errors and refusals, by block: the write is refused while any remain. */
  errors: string[];
  /** The analyst's signals and what the layout did, by block: for the model to judge. */
  warnings: string[];
};

/**
 * Hand-drawn charts: an inline SVG outside a chart block with several bars in it.
 * @param html
 */
function handDrawnCharts(html: string): number {
  const outside = html.replace(BLOCK, '');
  const svgs = outside.match(/<svg\b[\s\S]*?<\/svg>/gi) ?? [];
  return svgs.filter(s => (s.match(/<rect\b/gi) ?? []).length >= 4).length;
}

/**
 * Validate, check and draw every chart block in a document.
 * @param html - The document as the author wrote it.
 * @param width - The content width to lay charts out at.
 */
export function expandChartBlocks(html: string, width = DOCUMENT_CHART_WIDTH): ChartBlockResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let n = 0;
  const out = html.replace(BLOCK, (whole, attrs: string, body: string) => {
    n += 1;
    const which = `chart block ${n}`;
    const raw = SPEC.exec(body)?.[1];
    if (!raw) {
      errors.push(`${which}: no <script type="application/json"> spec inside the <figure class="vocion-chart">.`);
      return whole;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      errors.push(`${which}: the spec is not valid JSON (${(err as Error).message}).`);
      return whole;
    }
    const parsed = chartSpecSchema.safeParse(json);
    if (!parsed.success) {
      errors.push(`${which}: ${parsed.error.issues.map(i => `${i.path.join('.') || 'spec'}: ${i.message}`).join('; ')}`);
      return whole;
    }
    const checks = checkChart(parsed.data);
    errors.push(...checks.refusals.map(e => `${which} [${e.rule}]: ${e.message}`));
    warnings.push(...checks.signals.map(w => `${which} [${w.rule}]: ${w.message}`));
    warnings.push(...factNotes(layoutChart(parsed.data, { width }).facts, { brief: true }).map(note => `${which}: ${note}`));
    const keep = attrs.replace(/\sdata-vocion-chart\s*=\s*["'][^"']*["']/i, '');
    const spec = JSON.stringify(parsed.data).replace(/<\//g, '<\\/');
    return `<figure${keep} data-vocion-chart="${n}"><script type="application/json">${spec}</script>${chartFigureInner(parsed.data, width, `vc${n}`)}</figure>`;
  });
  const hand = handDrawnCharts(out);
  if (hand > 0) {
    warnings.push(`${hand} chart${hand === 1 ? ' is' : 's are'} drawn by hand as inline SVG. Use a chart block (<figure class="vocion-chart"> with the spec), so the library lays it out, it reads on a phone and it redraws when the numbers change.`);
  }
  if (n === 0) {
    return { html: out, count: 0, errors, warnings };
  }
  // The base styles go in once, ahead of the author's: re-expansion swaps, never stacks.
  const stripped = out.replace(STYLE, '');
  const withStyle = /<\/head>/i.test(stripped) ? stripped.replace(/<\/head>/i, `${BASE_CSS}</head>`) : `${BASE_CSS}${stripped}`;
  return { html: withStyle, count: n, errors, warnings };
}
