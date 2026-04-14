import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '@/models/Schema';

const createDbConnection = () => {
  const client = new PGlite();

  return drizzle(client, { schema });
};

const db = createDbConnection();

await migrate(db, {
  migrationsFolder: path.join(process.cwd(), 'migrations'),
});

export { db };
