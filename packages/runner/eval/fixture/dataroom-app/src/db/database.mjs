// An in-memory database with a real schema: a table takes only the columns its migrations made.
// Reads hand out copies, so a caller cannot change a row without update(). `stats` counts reads
// and writes, which is how the tests hold a page to a fixed number of reads.
const copy = row => structuredClone(row);

export function createDatabase() {
  const tables = new Map();
  const stats = { reads: 0, writes: 0 };
  const meta = { schemaVersion: 0 };

  function table(name) {
    const t = tables.get(name);
    if (!t) {
      throw new Error(`no table ${name}`);
    }
    return t;
  }

  function checkColumns(name, row) {
    const t = table(name);
    for (const k of Object.keys(row)) {
      if (!t.columns.has(k)) {
        throw new Error(`table ${name} has no column ${k}`);
      }
    }
  }

  return {
    stats,
    meta,
    createTable(name, columns) {
      if (tables.has(name)) {
        throw new Error(`table ${name} exists`);
      }
      tables.set(name, { columns: new Map(Object.entries(columns)), rows: [] });
    },
    addColumn(name, column, defaultValue = null) {
      const t = table(name);
      if (t.columns.has(column)) {
        throw new Error(`table ${name} already has ${column}`);
      }
      t.columns.set(column, defaultValue);
      for (const r of t.rows) {
        r[column] = typeof defaultValue === 'function' ? defaultValue(r) : structuredClone(defaultValue);
      }
    },
    hasTable: name => tables.has(name),
    hasColumn: (name, column) => tables.has(name) && table(name).columns.has(column),
    columns: name => [...table(name).columns.keys()],
    insert(name, row) {
      checkColumns(name, row);
      const t = table(name);
      const full = {};
      for (const [c, d] of t.columns) {
        full[c] = row[c] === undefined ? (typeof d === 'function' ? d(row) : structuredClone(d)) : structuredClone(row[c]);
      }
      if (full.id && t.rows.some(r => r.id === full.id)) {
        throw new Error(`${name} ${full.id} exists`);
      }
      t.rows.push(full);
      stats.writes++;
      return copy(full);
    },
    update(name, id, patch) {
      checkColumns(name, patch);
      const r = table(name).rows.find(x => x.id === id);
      if (!r) {
        return null;
      }
      Object.assign(r, structuredClone(patch));
      stats.writes++;
      return copy(r);
    },
    remove(name, predicate) {
      const t = table(name);
      const before = t.rows.length;
      t.rows = t.rows.filter(r => !predicate(r));
      stats.writes++;
      return before - t.rows.length;
    },
    find(name, id) {
      stats.reads++;
      const r = table(name).rows.find(x => x.id === id);
      return r ? copy(r) : null;
    },
    where(name, predicate) {
      stats.reads++;
      return table(name).rows.filter(predicate).map(copy);
    },
    all(name) {
      stats.reads++;
      return table(name).rows.map(copy);
    },
  };
}
