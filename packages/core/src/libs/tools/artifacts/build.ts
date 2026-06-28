/**
 * Pure builders for artifact content (CSV, simple SVG chart, doc).
 * No I/O — callers pass the result to `saveArtifact`.
 */

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
 * Minimal, dependency-free SVG bar/line chart.
 * @param spec
 */
export function toChartSvg(spec: ChartSpec): string {
  const w = 720;
  const h = 360;
  const pad = { top: 48, right: 24, bottom: 56, left: 48 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const points = spec.points.length ? spec.points : [{ label: '—', value: 0 }];
  const max = Math.max(1, ...points.map(p => p.value));
  const x = (i: number) => pad.left + (points.length === 1 ? plotW / 2 : (i * plotW) / (points.length - 1));
  const y = (v: number) => pad.top + plotH - (v / max) * plotH;

  const axis = `<line x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}" y2="${pad.top + plotH}" stroke="#cbd5e1"/>`;
  const title = spec.title
    ? `<text x="${w / 2}" y="28" text-anchor="middle" font-family="system-ui,sans-serif" font-size="18" font-weight="600" fill="#0f172a">${escapeXml(spec.title)}</text>`
    : '';
  const labels = points
    .map((p, i) => `<text x="${x(i).toFixed(1)}" y="${h - 20}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="#475569">${escapeXml(p.label)}</text>`)
    .join('');

  let body: string;
  if (spec.type === 'line') {
    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
    const dots = points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.5" fill="#4f46e5"/>`).join('');
    body = `<path d="${d}" fill="none" stroke="#4f46e5" stroke-width="2.5"/>${dots}`;
  } else {
    const bw = Math.max(8, (plotW / points.length) * 0.6);
    body = points
      .map((p, i) => {
        const bx = x(i) - bw / 2;
        const by = y(p.value);
        return `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${(pad.top + plotH - by).toFixed(1)}" rx="3" fill="#4f46e5"/>`;
      })
      .join('');
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#ffffff"/>${title}${axis}${body}${labels}</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', '\'': '&#39;' }[c]!));
}
