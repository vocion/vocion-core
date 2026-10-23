export function auditRepo(db, ids) {
  return {
    all: () => db.all('audit'),
    forTarget: targetId => db.where('audit', a => a.targetId === targetId),
    write: entry => db.insert('audit', { id: ids.next('aud'), ...entry }),
  };
}
