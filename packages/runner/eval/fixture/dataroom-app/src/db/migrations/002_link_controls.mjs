// Passcodes and the downloads switch on links.
export default {
  version: 2,
  name: 'link_controls',
  up(db) {
    db.addColumn('links', 'passcodeHash', null);
    db.addColumn('links', 'allowDownload', true);
  },
};
