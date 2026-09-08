import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '@/models/Schema';

const createDbConnection = () => {
  // PGlite ships pgvector as a bundled extension under
  // `@electric-sql/pglite/vector`. Loading it here means the
  // pgvector-using migration 0019 applies cleanly in tests against
  // the in-memory PGlite (otherwise CREATE EXTENSION fails because
  // vector.control isn't on /tmp/pglite/share/postgresql/extension/).
  const client = new PGlite({ extensions: { vector } });

  return drizzle(client, { schema });
};

const db = createDbConnection();

/**
 * Where drizzle's generated migrations live, resolved from THIS file rather
 * than from the working directory.
 *
 * `process.cwd()` used to be the base, which only worked when vitest was
 * launched from inside `packages/core`. Running it from the repo root — as
 * `.github/workflows/deploy-agent-runtime.yml` does with
 * `vitest run --root packages/core` — left every suite that touches the
 * database failing with "Can't find meta/_journal.json file", because
 * `--root` moves vitest's config root but not the process's cwd.
 */
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

await migrate(db, { migrationsFolder });

export { db };
