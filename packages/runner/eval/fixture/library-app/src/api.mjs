// Every HTTP route. handle() never throws: a bad request is a status and an error body.

export function summary(doc) {
  const { id, libraryId, ownerId, title, mimeType, sizeBytes, pageCount, uploadedAt } = doc;
  return { id, libraryId, ownerId, title, mimeType, sizeBytes, pageCount, uploadedAt };
}

const notFound = { status: 404, body: { error: 'not_found' } };
const signIn = { status: 401, body: { error: 'sign_in_required' } };

function visitorId(query, userId) {
  if (userId) {
    return userId;
  }
  return query.viewer ? `v:${query.viewer}` : 'v:anonymous';
}

export function handle(store, { method = 'GET', path, query = {}, body = {}, userId = null }) {
  const parts = String(path).split('?')[0].split('/').filter(Boolean);

  if (parts[0] === 'api' && parts[1] === 'documents') {
    if (!userId) {
      return signIn;
    }
    const [, , id, sub] = parts;
    if (!id && method === 'GET') {
      return { status: 200, body: { documents: store.listDocuments(userId, { q: query.q || '' }).map(summary) } };
    }
    const doc = store.findDocument(id);
    if (!doc) {
      return notFound;
    }
    if (!sub && method === 'GET') {
      return { status: 200, body: { document: summary(doc) } };
    }
    if (sub === 'links' && !store.canSee(userId, doc)) {
      return notFound;
    }
    if (sub === 'links' && method === 'GET') {
      return { status: 200, body: { links: store.linksFor(doc.id) } };
    }
    if (sub === 'links' && method === 'POST') {
      const recipientEmail = String(body.recipientEmail || '').trim();
      if (!recipientEmail.includes('@')) {
        return { status: 400, body: { error: 'recipient_email_required' } };
      }
      return { status: 201, body: { link: store.createLink(doc.id, { recipientEmail, createdBy: userId }) } };
    }
    return notFound;
  }

  if (parts[0] === 'l' && parts[1]) {
    const link = store.findLink(parts[1]);
    const doc = link && store.findDocument(link.docId);
    if (!doc) {
      return notFound;
    }
    if (!parts[2] && method === 'GET') {
      store.recordView(doc.id, { viewerId: visitorId(query, userId), linkId: link.id });
      const { id, title, pageCount, mimeType, sizeBytes } = doc;
      return { status: 200, body: { document: { id, title, pageCount, mimeType, sizeBytes }, link: { id: link.id } } };
    }
    if (parts[2] === 'download' && method === 'GET') {
      return { status: 200, body: { url: `/files/${doc.id}` } };
    }
  }

  return notFound;
}
