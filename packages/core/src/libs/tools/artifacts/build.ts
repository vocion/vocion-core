/**
 * Pure builders for artifact content (CSV, simple SVG chart, doc).
 * No I/O — callers pass the result to `saveArtifact`.
 */

import { renderChartSvg } from '@/libs/charts/svg';

export type CsvRow = Record<string, string | number>;

export function toCsv(rows: CsvRow[]): string {
  if (rows.length === 0) {
    return '';
  }
  const headers = Array.from(
    rows.reduce((set, r) => {
      Object.keys(r).forEach(k => set.add(k));
      return set;
    }, new Set<string>()),
  );
  const esc = (v: string | number | undefined): string => {
    const s = v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => esc(row[h])).join(','));
  }
  return lines.join('\n');
}

export type ChartPoint = { label: string; value: number };
export type ChartSpec = { type: 'bar' | 'line'; points: ChartPoint[]; title?: string };

/**
 * A one-series bar or line chart as a standalone SVG file, drawn by the
 * chart engine (`libs/charts`) on a white ground — the same layout the chat
 * card and a document's chart block use.
 * @param spec
 */
export function toChartSvg(spec: ChartSpec): string {
  const points = spec.points.length ? spec.points : [{ label: '—', value: 0 }];
  const svg = renderChartSvg({
    type: spec.type,
    ...(spec.title ? { title: spec.title } : {}),
    x: points.map(p => p.label),
    series: [{ name: spec.title ?? 'Value', values: points.map(p => p.value) }],
    format: 'number',
  }, { width: 720, height: 360 }, 'vcfile');
  const w = 720;
  const h = 360 + (spec.title ? 28 : 0);
  const title = spec.title
    ? `<text x="${w / 2}" y="20" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" font-weight="600" fill="#0f172a">${escapeXml(spec.title)}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#ffffff"/>${title}<g transform="translate(0 ${spec.title ? 28 : 0})">${svg.replace('width="100%"', `width="${w}" height="360"`)}</g></svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', '\'': '&#39;' }[c]!));
}
