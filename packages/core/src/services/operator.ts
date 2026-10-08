/**
 * Who operates this deployment — the one definition.
 *
 * An operator runs the installation itself — on a deployment hosting several
 * client accounts, the people who create accounts, set each account's spend
 * cap, see the installation-wide figures on the System page and offboard an
 * account that leaves. That is a different fact from any account role: an
 * account admin administers one client's account, and an operator need not
 * belong to any account at all to see every one of them.
 *
 * The list is configuration, not data — `VOCION_OPERATOR_EMAILS`, sign-in
 * emails separated by commas or whitespace — so no row in the database, and
 * no account admin, can make someone an operator. Unset or empty means nobody
 * is one, which is right for a self-hosted single-account install and the
 * safe default on a host that serves several companies.
 *
 * Because the list names emails, the one way round it would be to create a
 * login under a listed email nobody has signed up with yet. So an operator's
 * login is made on the instance (`create-local-user`), never by invite:
 * `MembersService.createInvite` refuses to invite a listed address that has no
 * login, and `/api/signup` refuses to create one for a listed address even
 * with a valid invite in hand.
 *
 * Two questions, two functions, one module: {@link isOperator} asks about an
 * email (sign-up, invites, offboarding a person), {@link isOperatorUser} about
 * a signed-in user id (every page and route that shows or does something
 * installation-wide). The list is read from `process.env` on every call rather
 * than once, so a script and the app read the same value and a test can set
 * it per case.
 */

import process from 'node:process';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { userSchema } from '@/models/Schema';

/**
 * The configured operator emails, lowercased. Commas or whitespace separate
 * them, so a list pasted one per line into a secret store reads the same as
 * one written on a single line.
 */
function operatorEmails(): ReadonlySet<string> {
  return new Set(
    (process.env.VOCION_OPERATOR_EMAILS ?? '')
      .split(/[\s,]+/)
      .map(entry => entry.trim().toLowerCase())
      .filter(entry => entry.length > 0),
  );
}

/**
 * Whether this email is on the operator list. Case-insensitive, as sign-in
 * is; a missing or empty email is never an operator.
 * @param email - A sign-in email, any case.
 */
export function isOperator(email: string | null | undefined): boolean {
  const normalized = (email ?? '').trim().toLowerCase();
  return normalized.length > 0 && operatorEmails().has(normalized);
}

/**
 * Whether the person behind a user id operates the deployment. Reads the email
 * off the user row rather than trusting a session's or a client's copy, so the
 * check is against who the person is now. No database read at all when nobody
 * is an operator.
 * @param userId - The signed-in person.
 */
export async function isOperatorUser(userId: string | null | undefined): Promise<boolean> {
  if (!userId || operatorEmails().size === 0) {
    return false;
  }
  const [user] = await db.select({ email: userSchema.email }).from(userSchema).where(eq(userSchema.id, userId)).limit(1);
  return isOperator(user?.email);
}
