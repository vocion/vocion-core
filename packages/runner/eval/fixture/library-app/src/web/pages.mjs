import { escapeHtml, layout } from './format.mjs';

export function libraryPage(store, userId, { q = '' } = {}) {
  const documents = store.listDocuments(userId, { q });
  const rows = documents.map(d => `<li data-testid="doc-row" data-id="${d.id}"><a class="title" href="/documents/${d.id}">${escapeHtml(d.title)}</a><div class="meta"></div></li>`).join('');
  const list = documents.length ? `<ul data-testid="library">${rows}</ul>` : '<p data-testid="empty">No documents</p>';
  return layout('Library', `<h1>Library</h1><form role="search" action="/"><input name="q" value="${escapeHtml(q)}"></form>${list}`);
}

export function documentPage(store, userId, id) {
  const doc = store.findDocument(id);
  if (!store.canSee(userId, doc)) {
    return null;
  }
  const links = store.linksFor(doc.id).map(l => `<li data-testid="link-row" data-id="${l.id}">${escapeHtml(l.recipientEmail)}</li>`).join('');
  return layout(doc.title, `<h1 data-testid="title">${escapeHtml(doc.title)}</h1><p data-testid="doc-meta"></p><section data-testid="links"><h2>Links</h2><ul>${links}</ul></section>`);
}

export function linkPage(store, linkId, { viewer = '' } = {}) {
  const link = store.findLink(linkId);
  const doc = link && store.findDocument(link.docId);
  if (!doc) {
    return layout('Not found', '<h1>This link does not exist</h1>');
  }
  store.recordView(doc.id, { viewerId: viewer ? `v:${viewer}` : 'v:anonymous', linkId: link.id });
  return layout(doc.title, `<h1 data-testid="title">${escapeHtml(doc.title)}</h1><a data-testid="download" href="/l/${link.id}/download">Download</a>`);
}
