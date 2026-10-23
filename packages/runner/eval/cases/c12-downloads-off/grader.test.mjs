import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkPage } from '../src/web/pages.mjs';
import { api, byTestId, storeAt, text } from './helpers.mjs';

const patch = (store, allowDownload, userId = 'u_owner') => api(store, { method: 'PATCH', path: '/api/documents/d1/links/l1', body: { allowDownload }, userId });

test('A1: members switch it, others cannot', () => {
  const store = storeAt();
  assert.equal(patch(store, false).status, 200);
  assert.equal(patch(store, true, 'u_teammate').status, 200);
  assert.equal(patch(store, false, 'u_other').status, 404);
  assert.equal(patch(store, 'no').status, 400);
  assert.equal(patch(store, 'no').body.error, 'invalid_allow_download');
});

test('A2: on by default', () => {
  const store = storeAt();
  assert.equal(api(store, { path: '/l/l1/download' }).status, 200);
  const made = api(store, { method: 'POST', path: '/api/documents/d5/links', body: { recipientEmail: 'buyer@acme.example' }, userId: 'u_owner' });
  assert.equal(api(store, { path: `/l/${made.body.link.id}/download` }).status, 200);
});

test('A3: off means 403 on download, the document still opens', () => {
  const store = storeAt();
  patch(store, false);
  const dl = api(store, { path: '/l/l1/download' });
  assert.equal(dl.status, 403);
  assert.equal(dl.body.error, 'download_disabled');
  const open = api(store, { path: '/l/l1' });
  assert.equal(open.status, 200);
  assert.equal(open.body.link.allowDownload, false);
  assert.equal(api(store, { path: '/l/l2/download' }).status, 200);
});

test('A4: the visitor page', () => {
  const store = storeAt();
  patch(store, false);
  const html = linkPage(store, 'l1');
  assert.equal(byTestId(html, 'download').length, 0);
  assert.match(text(byTestId(html, 'download-off')[0]), /Downloads are turned off for this link/);
  assert.equal(byTestId(linkPage(store, 'l2'), 'download').length, 1);
});

test('A5: the links list', () => {
  const store = storeAt();
  patch(store, false);
  const links = api(store, { path: '/api/documents/d1/links', userId: 'u_owner' }).body.links;
  assert.equal(links.find(l => l.id === 'l1').allowDownload, false);
  assert.equal(links.find(l => l.id === 'l2').allowDownload, true);
});
