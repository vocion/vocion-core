export function documentsRepo(db, ids) {
  return {
    find: id => db.find('documents', id),
    all: () => db.all('documents'),
    inLibrary: (libraryId, { archived = false } = {}) => db.where('documents', d => d.libraryId === libraryId && (archived || !d.archivedAt)),
    inLibraries: (libraryIds, { archived = false } = {}) => db.where('documents', d => libraryIds.includes(d.libraryId) && (archived || !d.archivedAt)),
    create: doc => db.insert('documents', { id: ids.next('doc'), ...doc }),
    update: (id, patch) => db.update('documents', id, patch),
    remove: id => db.remove('documents', d => d.id === id),
  };
}
