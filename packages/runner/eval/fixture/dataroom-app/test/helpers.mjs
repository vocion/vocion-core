// The product's dates are UTC, but lib/legacyDate.mjs reads local time; tests pin the zone.
import { createApp } from '../src/app.mjs';

process.env.TZ = 'UTC';

export { createApp };

export function request(app, { method = 'GET', path, user = null, query = {}, body = {}, headers = {} }) {
  return app.handle({ method, path, query, body, headers: { ...(user ? { 'x-user': user } : {}), ...headers } });
}

export function text(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/\s+/g, ' ').trim();
}

/** The HTML of every element carrying data-testid="<id>" (nesting-aware). */
export function byTestId(html, id) {
  const out = [];
  const re = new RegExp(`<(\\w+)[^>]*data-testid="${id}"[^>]*>`, 'g');
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const tag = m[1];
    const open = new RegExp(`<${tag}\\b`, 'g');
    const close = new RegExp(`</${tag}>`, 'g');
    let depth = 1;
    let i = m.index + m[0].length;
    while (depth > 0) {
      open.lastIndex = i;
      close.lastIndex = i;
      const o = open.exec(html);
      const c = close.exec(html);
      if (!c) {
        i = html.length;
        break;
      }
      if (o && o.index < c.index) {
        depth++;
        i = o.index + 1;
      } else {
        depth--;
        i = c.index + c[0].length;
      }
    }
    out.push(html.slice(m.index, i));
  }
  return out;
}

export const rowsById = (html, testId = 'doc-row') => Object.fromEntries(byTestId(html, testId).map(r => [r.match(/data-id="([^"]+)"/)[1], r]));
