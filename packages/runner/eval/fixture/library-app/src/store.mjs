import { seed } from './data.mjs';

// The data in memory and the queries over it. `store.db` is the data itself.
export function createStore(data = seed()) {
  const db = structuredClone(data);
  const store = {
    db,
    now: () => db.now,
    user: id => db.users.find(u => u.id === id) || null,
    librariesOf: userId => db.libraries.filter(l => l.members.includes(userId)),
    canSee(userId, doc) {
      return Boolean(doc) && store.librariesOf(userId).some(l => l.id === doc.libraryId);
    },
    findDocument: id => db.documents.find(d => d.id === id) || null,
    listDocuments(userId, { q = '' } = {}) {
      const libraries = new Set(store.librariesOf(userId).map(l => l.id));
      return db.documents
        .filter(d => libraries.has(d.libraryId))
        .filter(d => !q || d.title.includes(q))
        .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    },
    findLink: id => db.links.find(l => l.id === id) || null,
    linksFor: docId => db.links.filter(l => l.docId === docId),
    viewsFor: docId => db.views.filter(v => v.docId === docId),
    createLink(docId, { recipientEmail, createdBy }) {
      const link = { id: `l${db.links.length + 1}`, docId, recipientEmail, createdBy, createdAt: db.now };
      db.links.push(link);
      return link;
    },
    recordView(docId, { viewerId, linkId = null }) {
      const view = { docId, linkId, viewerId, at: db.now };
      db.views.push(view);
      return view;
    },
  };
  return store;
}
