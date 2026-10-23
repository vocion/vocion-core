import { notFound } from '../lib/validate.mjs';

/** Who may see a document: members of its library. */
export function createAccess({ repos }) {
  function canSee(userId, doc) {
    return Boolean(doc) && repos.libraries.isMember(doc.libraryId, userId);
  }
  return {
    canSee,
    /** The document, or not_found for anyone who may not see it. */
    visibleDocument(userId, id) {
      const doc = repos.documents.find(id);
      if (!canSee(userId, doc)) {
        throw notFound();
      }
      return doc;
    },
    role(userId, libraryId) {
      return repos.libraries.membership(libraryId, userId)?.role || null;
    },
  };
}
