// Shared by every dataroom grader. Copied beside the graders as .eval-grader/helpers.mjs, so a
// grader never depends on a test file the engineer may have changed. It imports only the
// product's stable entry points.
import { createApp } from '../src/app.mjs';
import { createDatabase } from '../src/db/database.mjs';
import { migrate, MIGRATIONS } from '../src/db/migrations/index.mjs';
import { seed } from '../src/db/seed.mjs';

process.env.TZ = process.env.EVAL_TZ || 'UTC';

export { createApp, createDatabase, migrate, MIGRATIONS, seed };

export function request(app, { method = 'GET', path, user = null, query = {}, body = {}, headers = {} }) {
  return app.handle({ method, path, query, body, headers: { ...(user ? { 'x-user': user } : {}), ...headers } });
}

export const api = (app, user, method, path, body = {}, extra = {}) => request(app, { method, path, user, body, ...extra });

/** The visible text of HTML: tags removed, entities decoded, spaces collapsed. */
export function text(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, '\'')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function byTestId(html, id) {
  const out = [];
  const re = new RegExp(`<(\\w+)[^>]*data-testid="${id}"[^>]*>`, 'g');
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const tag = m[1];
    if (/^(?:input|img|br|meta|link)$/i.test(tag)) {
      out.push(m[0]);
      continue;
    }
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

export const libraryRows = async (app, user = 'u_owner', query = {}) => rowsById((await request(app, { path: '/', user, query })).body);

/** Every source file of the product, as { file, text }, for the structural lines of a refactor. */
export async function sourceFiles(dir = 'src') {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const out = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      if (fs.statSync(p).isDirectory()) {
        walk(p);
      } else if (p.endsWith('.mjs') || p.endsWith('.js')) {
        out.push({ file: p.split(path.sep).join('/'), text: fs.readFileSync(p, 'utf8') });
      }
    }
  };
  walk(dir);
  return out;
}

/** Milliseconds for fn, best of `runs`. */
export function timeIt(fn, runs = 3) {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    best = Math.min(best, performance.now() - t);
  }
  return best;
}

/** The files under `paths` that differ from the commit the work started from (EVAL_BASE_SHA). */
export async function changedSinceBase(...paths) {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync('git', ['diff', '--name-only', process.env.EVAL_BASE_SHA, '--', ...paths], { encoding: 'utf8' }).trim();
  return out ? out.split('\n') : [];
}
