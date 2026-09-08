import { Buffer } from 'node:buffer';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { apiTokenSchema } from '@/models/Schema';
import 'dotenv/config';

/**
 * Make one stored credential undecryptable, the way a lost vault key does.
 *
 * The failure this reproduces is the common one in local dev and on a box
 * whose secret was rotated: the credential was encrypted under one vault key
 * and the running process holds a different one, so the ciphertext no longer
 * authenticates. Rewriting the auth tag produces exactly that — AES-GCM
 * refuses, the vault explains why, and the dashboard has something to show.
 *
 * Test-support only. It takes the newest row matching a platform and a name
 * rather than an id, because the spec that calls it has just saved that
 * credential through the UI and never learns the id. Both are required so a
 * database holding more than one org's credentials cannot be hit by accident.
 * Run through `dotenv -c` so it reads the same `.env.local` the app under test
 * reads.
 *
 * Usage:
 *   npx dotenv -c -- npx tsx e2e/credentials/support/scramble-stored-credential.ts \
 *     --platform azure-openai --name 'Vault Mismatch Co'
 */

/** A well-formed 16-byte auth tag that belongs to no ciphertext we hold. */
const WRONG_AUTH_TAG = Buffer.alloc(16, 7).toString('base64');

/**
 * Overwrite the auth tag of the newest credential stored under one name.
 * @param platform - The platform the credential belongs to.
 * @param name - The credential's name, as typed into the dashboard form.
 */
async function scrambleNewestCredential(platform: string, name: string): Promise<void> {
  const [token] = await db
    .select({ id: apiTokenSchema.id })
    .from(apiTokenSchema)
    .where(and(eq(apiTokenSchema.platform, platform), eq(apiTokenSchema.name, name)))
    .orderBy(desc(apiTokenSchema.createdAt))
    .limit(1);

  if (!token) {
    throw new Error(`No ${platform} credential named "${name}" is stored; save one before scrambling it.`);
  }

  await db
    .update(apiTokenSchema)
    .set({ authTag: WRONG_AUTH_TAG })
    .where(eq(apiTokenSchema.id, token.id));

  console.warn(`[scramble-stored-credential] ${platform} credential ${token.id} ("${name}") can no longer be decrypted`);
}

const { values } = parseArgs({
  options: {
    platform: { type: 'string' },
    name: { type: 'string' },
  },
});

if (!values.platform || !values.name) {
  console.error('[scramble-stored-credential] --platform and --name are both required');
  process.exit(1);
}

// `.then()` rather than a top-level await: this file is compiled to CommonJS
// when tsx runs it from outside `src`, and CommonJS has no top-level await.
scrambleNewestCredential(values.platform, values.name)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
