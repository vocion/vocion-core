export function librariesRepo(db) {
  return {
    find: id => db.find('libraries', id),
    all: () => db.all('libraries'),
    members: libraryId => db.where('memberships', m => m.libraryId === libraryId),
    membership: (libraryId, userId) => db.where('memberships', m => m.libraryId === libraryId && m.userId === userId)[0] || null,
    isMember(libraryId, userId) {
      return Boolean(userId) && db.where('memberships', m => m.libraryId === libraryId && m.userId === userId).length > 0;
    },
    forUser: userId => db.where('memberships', m => m.userId === userId).map(m => m.libraryId),
  };
}
