import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, createApp, request, rowsById } from './helpers.mjs';

const find = async (app, q, user = 'u_owner') => (await request(app, { path: '/api/documents', user, query: { q } })).body.documents.map(d => d.id);
const page = async (app, q, user = 'u_owner') => Object.keys(rowsById((await request(app, { path: '/', user, query: { q } })).body));
const rename = (app, id, title, user = 'u_owner') => api(app, user, 'PATCH', `/api/documents/${id}`, { title });

test('A1: a renamed document is found by its new title, in title order, on the page and the API', async () => {
  const app = createApp();
  await rename(app, 'd2', 'Rate Card 2027');
  assert.deepEqual(await find(app, 'rate'), ['d2']);
  assert.deepEqual(await page(app, 'rate card'), ['d2']);
  await rename(app, 'd3', 'Zebra Board Notes', 'u_teammate');
  assert.deepEqual(await find(app, 'board'), ['d1', 'd3']);
  await rename(app, 'd3', 'Annual Board Notes');
  assert.deepEqual(await find(app, 'board'), ['d3', 'd1']);
});

test('A2: the old title no longer finds it', async () => {
  const app = createApp();
  await rename(app, 'd2', 'Rate Card 2027');
  assert.deepEqual(await find(app, 'pricing'), []);
  assert.deepEqual(await page(app, 'pricing'), []);
});

test('A3: create, archive, unarchive and delete still keep search current', async () => {
  const app = createApp();
  const doc = (await api(app, 'u_owner', 'POST', '/api/documents', { libraryId: 'lib_team', title: 'Kestrel Term Sheet' })).body.document;
  assert.deepEqual(await find(app, 'kestrel'), [doc.id]);
  await api(app, 'u_owner', 'POST', `/api/documents/${doc.id}/archive`, {});
  assert.deepEqual(await find(app, 'kestrel'), []);
  await api(app, 'u_owner', 'POST', `/api/documents/${doc.id}/archive`, { archived: false });
  await rename(app, doc.id, 'Kestrel Final Terms');
  assert.deepEqual(await find(app, 'final'), [doc.id]);
  await api(app, 'u_owner', 'DELETE', `/api/documents/${doc.id}`);
  assert.deepEqual(await find(app, 'kestrel'), []);
  assert.deepEqual(await find(app, 'private', 'u_owner'), []);
});
