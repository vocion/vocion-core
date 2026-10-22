// Renders the pages for the seed data into dist/, so a static preview can serve them.
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from '../src/store.mjs';
import { documentPage, libraryPage } from '../src/web/pages.mjs';

const out = path.resolve('dist');
fs.mkdirSync(path.join(out, 'documents'), { recursive: true });
const store = createStore();
fs.writeFileSync(path.join(out, 'index.html'), libraryPage(store, 'u_owner'));
for (const doc of store.listDocuments('u_owner')) {
  fs.writeFileSync(path.join(out, 'documents', `${doc.id}.html`), documentPage(store, 'u_owner', doc.id));
}
