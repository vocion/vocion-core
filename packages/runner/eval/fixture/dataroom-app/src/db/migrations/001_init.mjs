export default {
  version: 1,
  name: 'init',
  up(db) {
    db.createTable('users', { id: null, email: null, name: null, prefs: {} });
    db.createTable('libraries', { id: null, name: null, createdAt: null });
    db.createTable('memberships', { id: null, libraryId: null, userId: null, role: 'editor' });
    db.createTable('documents', { id: null, libraryId: null, ownerId: null, title: null, mimeType: null, sizeBytes: 0, pageCount: 0, uploadedAt: null });
    db.createTable('links', { id: null, docId: null, recipientEmail: null, createdBy: null, createdAt: null });
    db.createTable('views', { id: null, linkId: null, docId: null, viewerEmail: null, userId: null, at: null, userAgent: '' });
    db.createTable('audit', { id: null, at: null, actorId: null, action: null, targetId: null, detail: {} });
    db.createTable('outbox', { id: null, type: null, to: null, subject: null, body: null, at: null, key: null });
  },
};
