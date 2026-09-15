import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '@/models/Schema';
import { createDbConnection } from '@/utils/DBConnection';

// One database handle per process, kept on globalThis. Two reasons, and both
// apply in production, so there is no NODE_ENV guard here:
//   - `next dev` re-evaluates this module on hot reload, and each evaluation
//     would open another pool.
//   - `next build` bundles this module into more than one server chunk (the
//     dashboard layout and its pages import it from different chunks), so a
//     module-level constant is created once per chunk, not once per process.
//     Against real Postgres that only wastes connections. Against the PGlite
//     socket server the E2E suite boots (`db-server:memory`), which accepts a
//     single client at a time, the second pool waits for the first one's idle
//     timeout (10 s) before it can connect, and every dashboard render pays it.
const globalForDb = globalThis as unknown as {
  drizzle: NodePgDatabase<typeof schema>;
};

globalForDb.drizzle ??= createDbConnection();

const db = globalForDb.drizzle;

export { db };
