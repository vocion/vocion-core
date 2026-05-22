/**
 * migrate-prod — runtime migration runner that works inside the
 * Next.js standalone image (no drizzle-kit devDep required).
 *
 * Why: `drizzle-kit migrate` is the canonical tool but it's a dev
 * dependency, trimmed out of the standalone Docker image. Running
 * `npm run db:migrate` inside the prod container fails with
 * MODULE_NOT_FOUND. Drizzle's `drizzle-orm/node-postgres/migrator`
 * exposes the same migration engine as a runtime import.
 *
 * Usage:
 *
 *   node packages/core/dist/scripts/migrate-prod.js
 *
 * Or via the runtime container:
 *
 *   docker compose exec app sh -c \
 *     'cd packages/core && node -e "require(\"./src/scripts/migrate-prod\")"'
 *
 * Reads DATABASE_URL from env; fails loudly if missing.
 */

import path from 'node:path';
import process from 'node:process';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const log = (...args: unknown[]) => {
  // eslint-disable-next-line no-console
  console.log('[migrate-prod]', ...args);
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  log(`connecting to ${url.replace(/:[^:@]+@/, ':***@')}`);
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);
  const migrationsFolder = path.resolve(process.cwd(), 'migrations');
  log(`applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  await pool.end();
  log('done');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[migrate-prod] FAILED:', (err as Error).stack ?? err);
    process.exit(1);
  });
