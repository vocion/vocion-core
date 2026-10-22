// A local server for trying the app by hand: `npm start`, then open http://localhost:5274/.
import http from 'node:http';
import { handle } from './api.mjs';
import { createStore } from './store.mjs';
import { documentPage, libraryPage, linkPage } from './web/pages.mjs';

const store = createStore();
const userId = process.env.LIBRARY_USER || 'u_owner';
const port = Number(process.env.PORT) || 5274;

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const query = Object.fromEntries(url.searchParams);
  let chunks = '';
  req.on('data', (c) => {
    chunks += c;
  });
  req.on('end', () => {
    if (url.pathname.startsWith('/api/') || /^\/l\/[^/]+\/download$/.test(url.pathname)) {
      const body = chunks ? JSON.parse(chunks) : {};
      const out = handle(store, { method: req.method, path: url.pathname, query, body, userId });
      res.writeHead(out.status, { 'content-type': 'application/json' }).end(JSON.stringify(out.body));
      return;
    }
    const doc = url.pathname.match(/^\/documents\/([^/]+)$/);
    const link = url.pathname.match(/^\/l\/([^/]+)$/);
    const html = doc ? documentPage(store, userId, doc[1]) : link ? linkPage(store, link[1], query) : libraryPage(store, userId, query);
    res.writeHead(html ? 200 : 404, { 'content-type': 'text/html' }).end(html || 'Not found');
  });
}).listen(port);
