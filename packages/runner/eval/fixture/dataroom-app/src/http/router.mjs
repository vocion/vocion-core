import { HttpError } from '../lib/validate.mjs';

/**
 * The route table. A route is [method, pattern, handler, { auth }]; a pattern's :name segments
 * become ctx.params. A handler gets ctx and returns { status, json } , { status, html } or a
 * full response. HEAD is answered by the GET route.
 */
export function createRouter(routes) {
  const table = routes.map(([method, pattern, handler, options = {}]) => {
    const names = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, n) => {
      names.push(n);
      return '([^/]+)';
    })}$`);
    return { method, re, names, handler, auth: options.auth ?? pattern.startsWith('/api/') };
  });

  return async function handle(req, app) {
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const path = req.path.split('?')[0];
    for (const r of table) {
      const m = r.method === method && path.match(r.re);
      if (!m) {
        continue;
      }
      const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      const userId = req.headers?.['x-user'] || null;
      const user = userId ? app.repos.users.find(userId) : null;
      if (r.auth && !user) {
        return json(401, { error: 'unauthorized' });
      }
      const ctx = { req, params, query: req.query || {}, body: req.body || {}, user, ...app };
      try {
        return toResponse(await r.handler(ctx));
      } catch (e) {
        if (e instanceof HttpError) {
          return json(e.status, { error: e.code, ...(e.detail ? { detail: e.detail } : {}) });
        }
        throw e;
      }
    }
    return json(404, { error: 'not_found' });
  };
}

export function json(status, body) {
  return { status, type: 'json', headers: { 'content-type': 'application/json' }, body };
}

export function html(status, body) {
  return { status, type: 'html', headers: { 'content-type': 'text/html; charset=utf-8' }, body };
}

function toResponse(r) {
  if (r.type) {
    return r;
  }
  if ('html' in r) {
    return html(r.status ?? 200, r.html);
  }
  return json(r.status ?? 200, r.json ?? {});
}
