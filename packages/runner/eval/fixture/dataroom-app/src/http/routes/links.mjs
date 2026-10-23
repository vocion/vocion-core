import { notFound } from '../../lib/validate.mjs';

const view = l => ({ id: l.id, docId: l.docId, recipientEmail: l.recipientEmail, createdAt: l.createdAt, allowDownload: l.allowDownload !== false, hasPasscode: Boolean(l.passcodeHash) });

export const linkRoutes = [
  ['GET', '/api/documents/:id/links', ({ user, params, repos }) => {
    const doc = repos.documents.find(params.id);
    if (!doc || !repos.libraries.isMember(doc.libraryId, user.id)) {
      throw notFound();
    }
    return { json: { links: repos.links.forDocument(doc.id).map(view) } };
  }],

  ['POST', '/api/documents/:id/links', ({ user, params, body, services }) => {
    const link = services.sharing.createLink(user.id, params.id, body.recipientEmail);
    return { status: 201, json: { link: view(link) } };
  }],

  ['PATCH', '/api/documents/:id/links/:linkId', ({ user, params, body, services }) => {
    const link = services.sharing.updateLink(user.id, params.id, params.linkId, body);
    return { json: { link: view(link) } };
  }],

  ['DELETE', '/api/documents/:id/links/:linkId', ({ user, params, services }) => {
    services.sharing.removeLink(user.id, params.id, params.linkId);
    return { status: 204, json: {} };
  }],
];
