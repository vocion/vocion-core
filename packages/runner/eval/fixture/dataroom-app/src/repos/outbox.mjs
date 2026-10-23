export function outboxRepo(db, ids) {
  return {
    all: () => db.all('outbox'),
    to: email => db.where('outbox', o => o.to === email),
    byKey: key => db.where('outbox', o => o.key === key),
    where: predicate => db.where('outbox', predicate),
    insert: message => db.insert('outbox', { id: ids.next('msg'), ...message }),
  };
}
