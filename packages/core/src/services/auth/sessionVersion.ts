/**
 * Ending a person's other sessions.
 *
 * Sessions are JWTs, so there is no row to delete. Instead `user.session_version`
 * is raised whenever the person's sign-in changes under them, every session
 * token is stamped with the number current when it was issued (`completeSignIn`
 * in `libs/Auth.ts`), and the session callback reads a token carrying an older
 * number as signed out. A reset password therefore removes whoever was using the
 * account, which is the most common reason to reset one.
 *
 * Raised by: a password reset by link, a password change on the profile page,
 * two-step sign-in turned on or off, an admin resetting it, and the operator
 * scripts that do either. The session the person made the change from is kept
 * (`keepThisSession` in `libs/Auth.ts`) — the change ends their OTHER sessions.
 *
 * The demo sandbox never ends sessions (`libs/identity/demoSandbox.ts`).
 */

import type { DbTransaction } from '@/libs/DbTransaction';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { isDemoSandbox } from '@/libs/identity/demoSandbox';
import { userSchema } from '@/models/Schema';

/**
 * Raise a person's session version, ending every session issued before now.
 * @param userId - The person.
 * @param tx - The transaction the change that caused it runs in, when there is one.
 * @returns The new version, or null when the person does not exist (or this is the demo sandbox).
 */
export async function endOtherSessions(userId: string, tx?: DbTransaction): Promise<number | null> {
  if (isDemoSandbox()) {
    return null;
  }
  const [row] = await (tx ?? db)
    .update(userSchema)
    .set({ sessionVersion: sql`${userSchema.sessionVersion} + 1` })
    .where(eq(userSchema.id, userId))
    .returning({ sessionVersion: userSchema.sessionVersion });
  return row?.sessionVersion ?? null;
}

/**
 * The version a session for this person must carry to count, or null when the
 * person no longer exists.
 * @param userId - The person.
 */
export async function currentSessionVersion(userId: string): Promise<number | null> {
  const [row] = await db
    .select({ sessionVersion: userSchema.sessionVersion })
    .from(userSchema)
    .where(eq(userSchema.id, userId))
    .limit(1);
  return row ? row.sessionVersion : null;
}
