import process from 'node:process';
import { parseArgs } from 'node:util';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { apiTokenSchema } from '@/models/Schema';
import 'dotenv/config';

/**
 * Revoke every live credential stored under one name for a platform.
 *
 * A spec that saves a key through the UI leaves it there, and the database a
 * spec runs against is usually the same one it ran against last time. So a
 * spec whose first assertion is "this workspace has no key of its own" passes
 * once and fails every run after — the worst kind of failure, because it looks
 * like a regression in the code under test.
 *
 * Revoking rather than deleting, because that is what the app itself does and
 * it leaves the audit trail alone.
 *
 * Test-support only, and keyed by name rather than by account for the reason
 * the sibling script is: a spec saves its credential through the UI and never
 * learns the account id the app scoped it to, but it always knows what it
 * typed into the name field. Both arguments are required so a database holding
 * several specs' credentials cannot be cleared by accident. Run through
 * `dotenv -c` so it reads the same `.env.local` the app under test reads.
 *
 * Usage:
 *   npx dotenv -c -- npx tsx e2e/credentials/support/revoke-stored-credentials.ts \
 *     --platform tavily --name 'Tool Key Co Tavily'
 */

/**
 * Revoke the live rows, if there are any. Revoking nothing is a success:
 * the point is the state afterwards, not how it got there.
 * @param platform - The platform whose credentials to revoke.
 * @param name - The credential's name, as typed into the dashboard form.
 */
async function revokeLiveCredentials(platform: string, name: string): Promise<void> {
  const revoked = await db
    .update(apiTokenSchema)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(apiTokenSchema.platform, platform),
      eq(apiTokenSchema.name, name),
      isNull(apiTokenSchema.revokedAt),
    ))
    .returning({ id: apiTokenSchema.id });

  console.warn(`[revoke-stored-credentials] revoked ${revoked.length} live ${platform} credential(s) named "${name}"`);
}

const { values } = parseArgs({
  options: {
    platform: { type: 'string' },
    name: { type: 'string' },
  },
});

if (!values.platform || !values.name) {
  console.error('[revoke-stored-credentials] --platform and --name are both required');
  process.exit(1);
}

// `.then()` rather than a top-level await, for the reason the sibling script
// gives: tsx compiles this to CommonJS when it runs from outside `src`.
revokeLiveCredentials(values.platform, values.name)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
