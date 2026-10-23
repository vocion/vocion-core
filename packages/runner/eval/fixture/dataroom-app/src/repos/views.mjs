export function viewsRepo(db, ids) {
  return {
    all: () => db.all('views'),
    forDocument: docId => db.where('views', v => v.docId === docId),
    forLink: linkId => db.where('views', v => v.linkId === linkId),
    record: view => db.insert('views', { id: ids.next('view'), ...view }),
  };
}
