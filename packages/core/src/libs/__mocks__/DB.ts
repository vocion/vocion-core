import path from 'node:path';
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

await migrate(db, {
  migrationsFolder: path.join(process.cwd(), 'migrations'),
});

export { db };
