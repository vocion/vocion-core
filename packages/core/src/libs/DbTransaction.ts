import type { db } from '@/libs/DB';

/**
 * A drizzle transaction, as `db.transaction` hands it to its callback.
 *
 * Lives beside the database client so any service can accept an optional `tx`
 * and join its caller's transaction, instead of each one re-deriving the type.
 */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
