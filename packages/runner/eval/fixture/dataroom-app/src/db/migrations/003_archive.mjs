export default {
  version: 3,
  name: 'archive',
  up(db) {
    db.addColumn('documents', 'archivedAt', null);
  },
};
