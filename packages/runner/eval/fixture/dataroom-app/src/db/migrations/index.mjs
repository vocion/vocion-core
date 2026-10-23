import init from './001_init.mjs';
import linkControls from './002_link_controls.mjs';
import archive from './003_archive.mjs';

export const MIGRATIONS = [init, linkControls, archive];

/** Runs every migration above the database's version, up to `to` (all of them by default). */
export function migrate(db, { to = Infinity } = {}) {
  const ran = [];
  for (const m of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (m.version > db.meta.schemaVersion && m.version <= to) {
      m.up(db);
      db.meta.schemaVersion = m.version;
      ran.push(m.version);
    }
  }
  return ran;
}
