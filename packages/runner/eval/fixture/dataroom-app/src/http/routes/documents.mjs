import { TITLE_MAX } from '../../config.mjs';
import { badRequest, forbidden, notFound, requireString } from '../../lib/validate.mjs';

const view = d => ({ id: d.id, libraryId: d.libraryId, title: d.title, mimeType: d.mimeType, sizeBytes: d.sizeBytes, pageCount: d.pageCount, uploadedAt: d.uploadedAt, archivedAt: d.archivedAt });

export const documentRoutes = [
  ['GET', '/api/documents', ({ user, query, repos, services }) => {
    const libraries = repos.libraries.forUser(user.id);
    const archived = query.archived === '1';
    const docs = query.q
      ? services.search.search(user.id, query.q, { archived }).map(id => repos.documents.find(id))
      : repos.documents.inLibraries(libraries, { archived });
    return { json: { documents: docs.map(view) } };
  }],

  ['GET', '/api/documents/:id', ({ user, params, repos }) => {
    const doc = repos.documents.find(params.id);
    if (!doc || !repos.libraries.isMember(doc.libraryId, user.id)) {
      throw notFound();
    }
    return { json: { document: view(doc) } };
  }],

  ['POST', '/api/documents', ({ user, body, repos, services, clock }) => {
    if (!repos.libraries.isMember(body.libraryId, user.id)) {
      throw notFound();
    }
    const title = requireString(body.title, 'invalid_title', { max: TITLE_MAX });
    const doc = repos.documents.create({ libraryId: body.libraryId, ownerId: user.id, title, mimeType: body.mimeType || 'application/pdf', sizeBytes: Number(body.sizeBytes) || 0, pageCount: Number(body.pageCount) || 1, uploadedAt: clock.now() });
    repos.audit.write({ at: clock.now(), actorId: user.id, action: 'document.created', targetId: doc.id, detail: { title } });
    services.events.emit('document.created', { doc });
    return { status: 201, json: { document: view(doc) } };
  }],

  // Rename: any member of the library.
  ['PATCH', '/api/documents/:id', ({ user, params, body, repos, clock }) => {
    const doc = repos.documents.find(params.id);
    if (!doc || !repos.libraries.isMember(doc.libraryId, user.id)) {
      throw notFound();
    }
    const title = requireString(body.title, 'invalid_title', { max: TITLE_MAX });
    const updated = repos.documents.update(doc.id, { title });
    repos.audit.write({ at: clock.now(), actorId: user.id, action: 'document.renamed', targetId: doc.id, detail: { from: doc.title, to: title } });
    return { json: { document: view(updated) } };
  }],

  // Archive and unarchive: only the person who uploaded it.
  ['POST', '/api/documents/:id/archive', ({ user, params, body, repos, services, clock }) => {
    const doc = repos.documents.find(params.id);
    if (!doc || !repos.libraries.isMember(doc.libraryId, user.id)) {
      throw notFound();
    }
    if (doc.ownerId !== user.id) {
      throw forbidden();
    }
    const archivedAt = body.archived === false ? null : clock.now();
    const updated = repos.documents.update(doc.id, { archivedAt });
    repos.audit.write({ at: clock.now(), actorId: user.id, action: archivedAt ? 'document.archived' : 'document.unarchived', targetId: doc.id });
    services.events.emit('document.archived', { doc: updated });
    return { json: { document: view(updated) } };
  }],

  // Delete: the uploader or a library owner.
  ['DELETE', '/api/documents/:id', ({ user, params, repos, services, clock }) => {
    const doc = repos.documents.find(params.id);
    if (!doc || !repos.libraries.isMember(doc.libraryId, user.id)) {
      throw notFound();
    }
    const role = repos.libraries.membership(doc.libraryId, user.id)?.role;
    if (doc.ownerId !== user.id && role !== 'owner') {
      throw forbidden();
    }
    if (repos.links.forDocument(doc.id).length) {
      throw badRequest('has_links', 'remove its links first');
    }
    repos.documents.remove(doc.id);
    repos.audit.write({ at: clock.now(), actorId: user.id, action: 'document.deleted', targetId: doc.id, detail: { title: doc.title } });
    services.events.emit('document.deleted', { doc });
    return { status: 204, json: {} };
  }],
];
