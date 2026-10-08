import process from 'node:process';
import { createLocalUser } from '@/scripts/support/createLocalUser';

/**
 * The E2E suite's user seeder: `src/scripts/create-local-user.ts` with the
 * same arguments and output, exempt from the single-Org rule like every other
 * test fixture (`services/OrgPolicy.ts`). The suite gives each spec its own
 * Org in one database, to test that Orgs cannot see each other, which a
 * single-Org server would otherwise refuse at the second spec.
 *
 * Test-support only. Run through `dotenv -c` so it reads the same
 * `.env.local` the app under test reads:
 *
 *   npx dotenv -c -- npx tsx tests/support/create-e2e-user.ts \
 *     --email e2e-admin@example.test --org "E2E Org" --password ...
 */

createLocalUser(async () => null).then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
