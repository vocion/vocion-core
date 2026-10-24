/**
 * The chart scene as an SVG string — what a document's chart block and a
 * deck slide embed. Self-contained (no CSS variables, no fonts to resolve)
 * because a document prints to PDF and is opened a year later with nothing
 * around it. The colors are the light steps of the same dataviz palette the
 * card uses (`VIZ_LIGHT`).
 *
 * The deck engine's embed point is {@link renderChartSvg}: lay out at the
 * slide's box size with a deck text size and drop the string in.
 */

import type { ChartScene, LayoutOptions, Mark, Paint } from './layout';
import type { ChartSpec } from './spec';
import { layoutChart } from './layout';
import { VIZ_LIGHT } from './palette';

const ROLE_LIGHT: Record<Exclude<Paint, { slot: number }>, string> = {
  grid: '#e7e8ec',
  baseline: '#9aa1ad',
  text: '#1f2937',
  muted: '#6b7280',
  target: '#374151',
  marker: '#6b7280',
  trend: '#9ca3af',
  surface: '#f5f6f8',
};

export function paintHex(p: Paint): string {
  return typeof p === 'object' ? VIZ_LIGHT[p.slot % VIZ_LIGHT.length]! : ROLE_LIGHT[p];
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', '\'': '&#39;' }[c]!));
}

const FONT = 'font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif"';

function f1(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function markSvg(m: Mark, idp: string): string {
  switch (m.kind) {
    case 'rect': {
      const tip = m.title ? `<title>${escapeXml(m.title)}</title>` : '';
      const base = `<rect x="${f1(m.x)}" y="${f1(m.y)}" width="${f1(m.w)}" height="${f1(m.h)}" rx="${f1(m.rx)}" fill="${paintHex(m.paint)}"${m.opacity !== undefined && m.opacity !== 1 ? ` fill-opacity="${m.opacity}"` : ''}>${tip}</rect>`;
      return m.hatch === undefined ? base : `${base}<rect x="${f1(m.x)}" y="${f1(m.y)}" width="${f1(m.w)}" height="${f1(m.h)}" rx="${f1(m.rx)}" fill="url(#${idp}-hatch-${m.hatch})"/>`;
    }
    case 'path':
      return `<path d="${m.d}" fill="${m.fill ? paintHex(m.fill) : 'none'}"${m.fill && m.opacity !== undefined ? ` fill-opacity="${m.opacity}"` : ''}${m.stroke ? ` stroke="${paintHex(m.stroke)}" stroke-width="${m.width ?? 2}" stroke-linejoin="round" stroke-linecap="round"` : ''}${m.dash ? ` stroke-dasharray="${m.dash}"` : ''}>${m.title ? `<title>${escapeXml(m.title)}</title>` : ''}</path>`;
    case 'line':
      return `<line x1="${f1(m.x1)}" y1="${f1(m.y1)}" x2="${f1(m.x2)}" y2="${f1(m.y2)}" stroke="${paintHex(m.paint)}" stroke-width="${m.width}"${m.dash ? ` stroke-dasharray="${m.dash}"` : ''}/>`;
    case 'circle':
      return `<circle cx="${f1(m.cx)}" cy="${f1(m.cy)}" r="${m.r}" fill="${paintHex(m.paint)}" stroke="#ffffff" stroke-width="2">${m.title ? `<title>${escapeXml(m.title)}</title>` : ''}</circle>`;
    case 'text':
      return `<text x="${f1(m.x)}" y="${f1(m.y)}" text-anchor="${m.anchor}"${m.middle ? ' dominant-baseline="middle"' : ''} font-size="${f1(m.size)}"${m.weight ? ` font-weight="${m.weight}"` : ''} fill="${paintHex(m.paint)}">${escapeXml(m.text)}</text>`;
  }
}

/**
 * The hatch for one palette slot: the slot's color in thin diagonal lines.
 * @param idp
 * @param slot
 */
function hatchDef(idp: string, slot: number): string {
  const c = VIZ_LIGHT[slot % VIZ_LIGHT.length]!;
  return `<pattern id="${idp}-hatch-${slot}" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${c}" stroke-width="2.2"/></pattern>`;
}

/**
 * The scene as one `<svg>` string, sized by its viewBox to fill its box.
 * @param scene - A laid-out chart.
 * @param idPrefix - Unique per chart on a page, so hatch patterns do not collide.
 */
export function sceneToSvg(scene: ChartScene, idPrefix = 'vc'): string {
  const title = scene.title ? `<title>${escapeXml(scene.title)}</title>` : '';
  const desc = `<desc>${escapeXml(scene.desc)}</desc>`;
  const defs = scene.hatchSlots.length ? `<defs>${scene.hatchSlots.map(s => hatchDef(idPrefix, s)).join('')}</defs>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" width="100%" role="img" style="display:block;height:auto;max-width:100%" ${FONT}>${title}${desc}${defs}${scene.marks.map(m => markSvg(m, idPrefix)).join('')}</svg>`;
}

function legendHtml(scene: ChartScene): string {
  if (!scene.legend.length) {
    return '';
  }
  const item = (l: ChartScene['legend'][number]) => {
    const c = l.slot === null ? ROLE_LIGHT.muted : VIZ_LIGHT[l.slot % VIZ_LIGHT.length]!;
    const swatch = l.style === 'hatch'
      ? `background:repeating-linear-gradient(45deg,${c} 0 2px,transparent 2px 5px);opacity:.85`
      : l.style === 'dash'
        ? `height:0;border-top:2px dashed ${c};width:14px;margin-top:5px`
        : l.style === 'line'
          ? `height:2px;width:14px;background:${c};margin-top:5px`
          : `background:${c}`;
    return `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:14px;white-space:nowrap"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;${swatch}"></span>${escapeXml(l.label)}</span>`;
  };
  return `<div class="vocion-chart-legend" style="margin-top:6px;font-size:11px;color:${ROLE_LIGHT.muted};line-height:1.6">${scene.legend.map(item).join('')}</div>`;
}

function tableHtml(scene: ChartScene): string {
  const head = `<tr>${scene.table.head.map(h => `<th scope="col">${escapeXml(h)}</th>`).join('')}</tr>`;
  const rows = scene.table.rows.map(r => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${escapeXml(c)}</th>` : `<td>${escapeXml(c)}</td>`)).join('')}</tr>`).join('');
  return `<table class="vocion-chart-data" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap"><caption>${escapeXml(scene.title ?? 'Chart data')}</caption><thead>${head}</thead><tbody>${rows}</tbody></table>`;
}

/**
 * Lay out and draw a chart as an SVG string — the embed point for documents
 * and decks.
 * @param spec - A spec that passed `chartSpecSchema` (and the lint).
 * @param opts - The box to draw in: width, optional height, text size.
 * @param idPrefix - Unique per chart on a page.
 */
export function renderChartSvg(spec: ChartSpec, opts: LayoutOptions, idPrefix = 'vc'): string {
  return sceneToSvg(layoutChart(spec, opts), idPrefix);
}

/**
 * The inner HTML of a document's chart block: the title (the finding), the
 * SVG, the legend, the caption (source and as-of), and the data as a
 * visually hidden table for screen readers and copy.
 * @param spec - The chart.
 * @param width - The content width it is laid out at, px.
 * @param idPrefix - Unique per chart in the document.
 */
export function chartFigureInner(spec: ChartSpec, width: number, idPrefix: string): string {
  const scene = layoutChart(spec, { width });
  const title = scene.title ? `<div class="vocion-chart-title" style="font-weight:600;font-size:13px;margin-bottom:2px">${escapeXml(scene.title)}</div>` : '';
  const subtitle = scene.subtitle ? `<div class="vocion-chart-subtitle" style="font-size:11px;color:${ROLE_LIGHT.muted};margin-bottom:4px">${escapeXml(scene.subtitle)}</div>` : '';
  const caption = scene.caption ? `<figcaption style="margin-top:4px;font-size:10px;color:${ROLE_LIGHT.muted}">${escapeXml(scene.caption)}</figcaption>` : '';
  return `${title}${subtitle}${sceneToSvg(scene, idPrefix)}${legendHtml(scene)}${caption}${tableHtml(scene)}`;
}
