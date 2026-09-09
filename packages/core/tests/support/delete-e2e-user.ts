import process from 'node:process';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { userSchema } from '@/models/Schema';
import 'dotenv/config';

/**
 * Delete one user by email. The E2E teardown's other half — the seeding side
 * is `src/scripts/create-local-user.ts`.
 *
 * Test-support only, and deliberately narrow: it takes an email, never an id
 * or a pattern, so it cannot be pointed at a table. Deleting the `user` row
 * cascades that user's `account_membership`, `session` and `auth_account`
 * rows (`onDelete: 'cascade'` in `models/Schema.ts`); the tenant account and
 * its projects are left alone, because the suite reuses them by name.
 *
 * Run through `dotenv -c` so it reads the same `.env.local` the app under
 * test reads:
 *
 *   npx dotenv -c -- npx tsx tests/support/delete-e2e-user.ts \
 *     --email e2e-admin@example.test
 */
async function main() {
  const { values } = parseArgs({ options: { email: { type: 'string' } } });
  const email = values.email?.toLowerCase();
  if (!email) {
    console.error('missing --email');
    process.exit(2);
  }

  const deleted = await db
    .delete(userSchema)
    .where(eq(userSchema.email, email))
    .returning({ id: userSchema.id });

  if (deleted.length === 0) {
    // Not a failure: the suite may have run against a fresh in-memory
    // database, or the seed step may have been skipped.
    console.warn(`no user to delete: ${email}`);
    return;
  }

  console.warn(`deleted user ${email} (${deleted[0]!.id})`);
}

// `.then()` rather than a top-level await: this file is compiled to CommonJS
// when tsx runs it from outside `src`, and CommonJS has no top-level await.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
