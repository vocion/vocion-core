import { documentPage } from '../../views/document.mjs';
import { libraryPage } from '../../views/library.mjs';

export const pageRoutes = [
  ['GET', '/', ({ user, query, repos, services }) => {
    const libraryId = query.library || repos.libraries.forUser(user.id)[0];
    if (!libraryId || !repos.libraries.isMember(libraryId, user.id)) {
      return { status: 404, html: '<p>No library</p>' };
    }
    const library = repos.libraries.find(libraryId);
    const archived = query.archived === '1';
    const documents = query.q
      ? services.search.search(user.id, query.q, { archived }).map(id => repos.documents.find(id)).filter(d => d.libraryId === libraryId)
      : repos.documents.inLibrary(libraryId, { archived }).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    return { html: libraryPage({ library, documents, stats: services.analytics.documentStats(documents), q: query.q || '' }) };
  }, { auth: true }],

  ['GET', '/documents/:id', ({ user, params, repos, services }) => {
    const doc = services.access.visibleDocument(user.id, params.id);
    return { html: documentPage({ doc, links: repos.links.forDocument(doc.id) }) };
  }, { auth: true }],
];
