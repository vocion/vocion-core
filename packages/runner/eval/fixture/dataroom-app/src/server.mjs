import http from 'node:http';
import { createApp } from './app.mjs';

const app = createApp();
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
  }
  const r = await app.handle({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body: raw ? JSON.parse(raw) : {} });
  res.writeHead(r.status, r.headers);
  res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
}).listen(Number(process.env.PORT) || 5280);
