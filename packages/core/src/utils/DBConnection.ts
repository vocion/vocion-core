import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { Env } from '@/libs/Env';
import * as schema from '@/models/Schema';

export const createDbConnection = () => {
  const pool = new Pool({
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
