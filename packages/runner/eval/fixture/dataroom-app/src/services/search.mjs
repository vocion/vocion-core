import { SEARCH_LIMIT } from '../config.mjs';

const words = s => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Title search over the documents a person can see. Every word of the query must start a word of
 * the title, in any order, ignoring case. The index keeps itself current from document events.
 */
export function createSearch({ repos, events }) {
  const index = new Map();
  const put = doc => index.set(doc.id, { id: doc.id, title: doc.title, libraryId: doc.libraryId, archivedAt: doc.archivedAt });
  for (const doc of repos.documents.all()) {
    put(doc);
  }
  events.on('document.created', ({ doc }) => put(doc));
  events.on('document.archived', ({ doc }) => put(doc));
  events.on('document.deleted', ({ doc }) => index.delete(doc.id));

  return {
    size: () => index.size,
    search(userId, q, { archived = false } = {}) {
      const terms = words(q);
      if (!terms.length) {
        return [];
      }
      const libraries = repos.libraries.forUser(userId);
      const hits = [];
      for (const entry of index.values()) {
        if (!libraries.includes(entry.libraryId) || (!archived && entry.archivedAt)) {
          continue;
        }
        const titleWords = words(entry.title);
        if (terms.every(t => titleWords.some(w => w.startsWith(t)))) {
          hits.push(entry);
        }
      }
      return hits.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)).slice(0, SEARCH_LIMIT).map(e => e.id);
    },
  };
}
