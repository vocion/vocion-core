/**
 * Reset a person's two-step sign-in. The operator's way back in for someone
 * who lost both their authenticator and their recovery codes, and the only one
 * for a person who belongs to more than one account (an account admin can
 * reset a member who belongs to their account alone, from the Members page).
 *
 * Removes the person's authenticator and recovery codes and ends every session
 * they have (`resetSecondFactor` in `services/auth/mfa.ts`). If an account or
 * the deployment requires two-step sign-in, they set up a new authenticator at
 * their next sign-in, before any workspace.
 *
 * Usage:
 *   npm run local:reset-mfa -- --email someone@northwind.example
 */

import process from 'node:process';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { userSchema } from '@/models/Schema';
import { resetSecondFactor } from '@/services/auth/mfa';
import 'dotenv/config';

async function main() {
  const { values } = parseArgs({ options: { email: { type: 'string' } } });
  const email = values.email?.trim().toLowerCase();
  if (!email) {
    console.error('missing --email');
    process.exit(2);
  }

  const [user] = await db
    .select({ id: userSchema.id, name: userSchema.name })
    .from(userSchema)
    .where(eq(userSchema.email, email))
    .limit(1);
  if (!user) {
    console.error(`no user with email ${email}`);
    process.exit(1);
  }

  const had = await resetSecondFactor(user.id);
  console.log(had
    ? `two-step sign-in reset for ${email} (${user.name ?? 'no name'}); their sessions are ended`
    : `${email} had no two-step sign-in; their sessions are ended anyway`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
