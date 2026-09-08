import { Buffer } from 'node:buffer';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { desc, eq } from 'drizzle-orm';
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
 * Test-support only. It takes the newest row for a platform rather than an id,
 * because the spec that calls it has just saved that credential through the UI
 * and never learns the id. Run through `dotenv -c` so it reads the same
 * `.env.local` the app under test reads.
 *
 * Usage:
 *   npx dotenv -c -- npx tsx e2e/credentials/support/scramble-stored-credential.ts --platform openai
 */

/** A well-formed 16-byte auth tag that belongs to no ciphertext we hold. */
const WRONG_AUTH_TAG = Buffer.alloc(16, 7).toString('base64');

/**
 * Overwrite the auth tag of the newest credential stored for one platform.
 * @param platform - The platform id whose newest credential should stop opening.
 */
async function scrambleNewestCredential(platform: string): Promise<void> {
  const [token] = await db
    .select({ id: apiTokenSchema.id })
    .from(apiTokenSchema)
    .where(eq(apiTokenSchema.platform, platform))
    .orderBy(desc(apiTokenSchema.createdAt))
    .limit(1);

  if (!token) {
    throw new Error(`No ${platform} credential is stored; save one before scrambling it.`);
  }

  await db
    .update(apiTokenSchema)
    .set({ authTag: WRONG_AUTH_TAG })
    .where(eq(apiTokenSchema.id, token.id));

  console.warn(`[scramble-stored-credential] ${platform} credential ${token.id} can no longer be decrypted`);
}

const { values } = parseArgs({
  options: {
    platform: { type: 'string', default: 'openai' },
  },
});

// `.then()` rather than a top-level await: this file is compiled to CommonJS
// when tsx runs it from outside `src`, and CommonJS has no top-level await.
scrambleNewestCredential(values.platform!)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
