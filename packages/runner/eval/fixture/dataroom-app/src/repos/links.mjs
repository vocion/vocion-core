export function linksRepo(db, ids) {
  return {
    find: id => db.find('links', id),
    all: () => db.all('links'),
    forDocument: docId => db.where('links', l => l.docId === docId),
    create: link => db.insert('links', { id: ids.next('lnk'), ...link }),
    update: (id, patch) => db.update('links', id, patch),
    remove: id => db.remove('links', l => l.id === id),
  };
}
