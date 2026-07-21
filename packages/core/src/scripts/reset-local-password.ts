/**
 * Reset a local-auth user's password.
 *
 * Fills the gap left by create-local-user.ts (which refuses to touch an
 * existing user). Hashes with the SAME `hashPassword` (bcrypt, cost 10)
 * that Auth.ts verifies against, and looks the user up by lowercased email
 * exactly as `authorize()` does — so the reset always matches login.
 *
 *   dotenv -c -- tsx src/scripts/reset-local-password.ts \
 *     --email chris@metacto.com --password '<new password>'
 */
import process from 'node:process';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { hashPassword } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { userSchema } from '@/models/Schema';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      password: { type: 'string' },
    },
  });
  if (!values.email || !values.password) {
    console.error('usage: reset-local-password.ts --email <email> --password <pw>');
    process.exit(1);
  }
  const email = values.email.toLowerCase();
  const passwordHash = await hashPassword(values.password);
  const rows = await db
    .update(userSchema)
    .set({ passwordHash })
    .where(eq(userSchema.email, email))
    .returning({ id: userSchema.id, email: userSchema.email });
  if (rows.length === 0) {
    console.error(`no user with email ${email}`);
    process.exit(1);
  }
  console.warn(`password reset for ${rows[0]!.email} (${rows[0]!.id}); hash len=${passwordHash.length}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
