// A static preview of the pages for the seed data, written to dist/.
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/app.mjs';

const app = createApp();
const out = path.resolve('dist');
fs.mkdirSync(path.join(out, 'documents'), { recursive: true });
const page = async (p, file) => fs.writeFileSync(path.join(out, file), (await app.handle({ path: p, headers: { 'x-user': 'u_owner' } })).body);
await page('/', 'index.html');
for (const d of app.repos.documents.inLibrary('lib_team')) {
  await page(`/documents/${d.id}`, `documents/${d.id}.html`);
}
console.log(`wrote ${out}`);
