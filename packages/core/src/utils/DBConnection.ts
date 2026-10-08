import { cpSync, existsSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import process from 'node:process';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { Env } from '@/libs/Env';
import { resolveDemoPath } from '@/libs/llm/replay';
import { isTenantContextEnabled } from '@/libs/tenantContext';
import * as schema from '@/models/Schema';
import { TenantContextPool } from './tenantContextPool';

/**
 * Open the database. Two drivers:
 *
 *   postgres://...  - node-postgres Pool (normal operation).
 *   pglite://<dir>  - in-process PGlite over a data directory. Used by the
 *                     hosted demo sandbox: when VOCION_DEMO_SEED_DIR is set,
 *                     the pristine seeded directory is copied to <dir> on
 *                     boot (each cold start = a fresh reset), so a shared
 *                     demo cleans itself up with zero infrastructure.
 */
export const createDbConnection = () => {
  if (Env.DATABASE_URL.startsWith('pglite://')) {
    const rawDataDir = Env.DATABASE_URL.slice('pglite://'.length);
    const base = isAbsolute(rawDataDir) ? rawDataDir : join(process.cwd(), rawDataDir);
    const rawSeed = process.env.VOCION_DEMO_SEED_DIR;
    const seedDir = rawSeed ? resolveDemoPath(rawSeed) : undefined;
    // Per-process data dir: concurrent processes (build workers, serverless
    // instances) never contend, and every cold start begins from the pristine
    // seed — the demo resets itself by construction.
    const dataDir = seedDir ? `${base}-${process.pid}` : base;
    if (seedDir && existsSync(seedDir)) {
      rmSync(dataDir, { recursive: true, force: true });
      cpSync(seedDir, dataDir, { recursive: true });
    }
    /* eslint-disable ts/no-require-imports */
    const { PGlite } = require('@electric-sql/pglite');
    const { vector } = require('@electric-sql/pglite/vector');
    const { drizzle: drizzlePglite } = require('drizzle-orm/pglite');
    /* eslint-enable ts/no-require-imports */
    const client = new PGlite(dataDir, { extensions: { vector } });
    return drizzlePglite({ client, schema }) as unknown as ReturnType<typeof drizzle<typeof schema>>;
  }

  // VOCION_DB_TENANT_CONTEXT=1 labels each query with the request's tenant
  // (libs/tenantContext.ts); otherwise the plain pool, unchanged.
  const PoolClass = isTenantContextEnabled() ? TenantContextPool : Pool;
  const pool = new PoolClass({
    connectionString: Env.DATABASE_URL,
    max: Env.DATABASE_URL.includes('localhost') || Env.DATABASE_URL.includes('127.0.0.1')
      ? 1
      : undefined,
  });

  return drizzle({
    client: pool,
    schema,
  });
};
