export function usersRepo(db) {
  return {
    find: id => db.find('users', id),
    byEmail: email => db.where('users', u => u.email.toLowerCase() === String(email || '').toLowerCase())[0] || null,
    all: () => db.all('users'),
    setPrefs(id, prefs) {
      const u = db.find('users', id);
      return u ? db.update('users', id, { prefs: { ...u.prefs, ...prefs } }) : null;
    },
  };
}
